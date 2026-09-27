import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "@/contexts/i18n";
import { messageFrom } from "@/contexts/api/errors";
import { previewLink, usePreviewStatus } from "@/contexts/api/sessions";
import type { Session } from "@/contexts/api/types";
import { shownPage } from "@/lib/transcript";
import { backoff } from "@/lib/backoff";
import { Address } from "@/ds/address";
import { Button } from "@/ds/button";
import { Empty } from "@/ds/empty";
import { Frame } from "@/ds/frame";
import { toast } from "@/ds/toast";

// A frame that has not finished loading after this long is loaded again, once per load; each hang in a row doubles
// the wait, up to a minute.
const HUNG = 10_000;
const HUNG_CAP = 60_000;
// Preview tokens last 12 hours; a fresh one is asked for after half of that.
const RENEW = 6 * 60 * 60 * 1000;

type Where = { path: string; title?: string; back: boolean; forward: boolean };

function remembered(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // This page only.
  }
}

function normalize(value: string, origin: string) {
  try {
    const url = new URL(value.trim(), origin);
    return url.origin === origin ? url.pathname + url.search + url.hash : null;
  } catch {
    return null;
  }
}

// The app as it runs in the session's sandbox. The preview is another origin, so every page it serves loads a small
// script (the plane adds it) that posts where it is; the frame is steered with messages back. Before the first page,
// the plane checks the app until it answers.
export function Preview({ session, host }: { session: Session; host: string }) {
  const { t } = useTranslations();
  // The preview is served as this page is: https on a cluster, http on a port for a local one.
  const origin = `${location.protocol}//${host}${location.port ? `:${location.port}` : ""}`;
  const pathKey = `hz.preview-path:${host}`;
  const status = usePreviewStatus(session.id);
  const up = status.data?.up ?? false;
  const frame = useRef<HTMLIFrameElement>(null);
  const [token, setToken] = useState<string>();
  const minted = useRef(0);
  const [error, setError] = useState<string>();
  // Bumped to ask for a link again: a retry after a failure, or a renewal.
  const [attempt, setAttempt] = useState(0);
  const [src, setSrc] = useState<string>();
  const [where, setWhere] = useState<Where>({ path: remembered(pathKey) ?? "/", back: false, forward: false });
  const [typed, setTyped] = useState<string>();
  // Whether the page in the frame carries the script: it answered the ping sent when it loaded.
  const [bridged, setBridged] = useState(false);
  const ping = useRef("");
  // When the frame was last given a page, when that page finished loading, when its script last spoke.
  const loaded = useRef(0);
  const done = useRef(0);
  const heard = useRef(0);
  // Paths visited, for back and forward on pages that carry no script (plain text, JSON).
  const visits = useRef<{ list: string[]; at: number }>({ list: [where.path], at: 0 });
  const visit = (path: string) => {
    const v = visits.current;
    if (v.list[v.at] === path) return;
    v.list = [...v.list.slice(0, v.at + 1), path];
    v.at = v.list.length - 1;
  };

  useEffect(() => {
    if (!up || (token && Date.now() - minted.current < RENEW)) return;
    let live = true;
    previewLink(host).then(
      (u) => {
        if (!live) return;
        minted.current = Date.now();
        setToken(new URL(u).searchParams.get("token") ?? "");
        setError(undefined);
      },
      (e) => live && setError(messageFrom(e, t)),
    );
    return () => {
      live = false;
    };
  }, [host, t, up, token, attempt]);

  // A failed link is asked for again on the next check of the app; a token is renewed before it runs out. The clock
  // is read every minute rather than trusted to one long timer, which a sleeping laptop would hold back.
  useEffect(() => {
    if (error) setAttempt((a) => a + 1);
  }, [status.dataUpdatedAt]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (minted.current && Date.now() - minted.current >= RENEW) setAttempt((a) => a + 1);
    }, 60_000);
    return () => clearInterval(timer);
  }, []);
  const again = () => {
    setError(undefined);
    setAttempt((a) => a + 1);
    status.refetch();
  };

  const [round, setRound] = useState(0);
  // The token the frame was last loaded with: once renewed, the next reload loads afresh so the cookie is renewed too.
  const used = useRef<string>(undefined);
  // A new frame each time: setting the same src again would not load it again.
  const load = useCallback(
    (path: string) => {
      const url = new URL(path, origin);
      if (token) url.searchParams.set("token", token);
      used.current = token;
      loaded.current = Date.now();
      setSrc(url.toString());
      setRound((r) => r + 1);
    },
    [origin, token],
  );

  useEffect(() => {
    if (up && token && !src) load(where.path);
  }, [up, token, src, load, where.path]);

  const post = (message: object) => frame.current?.contentWindow?.postMessage(message, origin);
  const live = () => bridged && used.current === token;
  // Hung loads in a row, and the round last reloaded for hanging.
  const hangs = useRef(0);
  const retried = useRef(-1);
  const settled = () => {
    done.current = Date.now();
    hangs.current = 0;
    setBridged(false);
    ping.current = Math.random().toString(36).slice(2);
    post({ type: "hz:ping", id: ping.current });
  };

  useEffect(() => {
    const listen = (e: MessageEvent) => {
      if (e.origin !== origin || e.data?.type !== "hz:url" || typeof e.data.path !== "string") return;
      heard.current = Date.now();
      // Only a ping's answer, or a history change (which comes after load), speaks for the page now in the frame.
      if ((e.data.reason === "ping" && e.data.id === ping.current) || /^(pushState|replaceState|popstate|hashchange)$/.test(e.data.reason)) {
        setBridged(true);
      }
      visit(e.data.path);
      setWhere({ path: e.data.path, title: e.data.title, back: !!e.data.back, forward: !!e.data.forward });
      remember(pathKey, e.data.path);
    };
    addEventListener("message", listen);
    return () => removeEventListener("message", listen);
  }, [origin, pathKey]);

  // A page that never finished loading: the request hung. Load it again, once for this load, unless its script has
  // spoken since (the page runs; something else it asked for is slow).
  useEffect(() => {
    if (!src) return;
    const timer = setInterval(() => {
      if (done.current >= loaded.current || heard.current >= loaded.current || retried.current === round) return;
      if (Date.now() - loaded.current < backoff(hangs.current, HUNG, HUNG_CAP)) return;
      retried.current = round;
      hangs.current++;
      load(where.path);
    }, 2000);
    return () => clearInterval(timer);
  }, [src, load, where.path, round]);

  const navigate = (path: string) => {
    const route = normalize(path, origin);
    if (!route) return;
    setWhere((w) => ({ ...w, path: route }));
    remember(pathKey, route);
    visit(route);
    if (live()) post({ type: "hz:navigate", path: route });
    else load(route);
  };
  const reload = () => (live() ? post({ type: "hz:reload" }) : load(where.path));
  // The app's front page, loaded afresh with the token.
  const home = () => {
    setWhere((w) => ({ ...w, path: "/" }));
    remember(pathKey, "/");
    visit("/");
    load("/");
  };
  // The page's own history when it has one; the visited addresses otherwise.
  const step = (delta: number) => {
    if (live() && (delta < 0 ? where.back : where.forward)) return post({ type: "hz:history", delta });
    const v = visits.current;
    const at = v.at + delta;
    if (at < 0 || at >= v.list.length) return;
    v.at = at;
    setWhere((w) => ({ ...w, path: v.list[at] }));
    load(v.list[at]);
  };
  // The page's own history first; the addresses visited here when the frame was reloaded from scratch.
  const canBack = (live() && where.back) || visits.current.at > 0;
  const canForward = (live() && where.forward) || visits.current.at < visits.current.list.length - 1;

  // The agent asked to show a page and the plane did: the latest such call, once. A denied or failed one is not shown.
  const asked = useMemo(() => shownPage(session.events), [session.events]);
  const askedKey = `hz.preview-asked:${session.id}`;
  useEffect(() => {
    if (!asked || !src || remembered(askedKey) === asked.id) return;
    remember(askedKey, asked.id);
    navigate(asked.path);
  }, [asked?.id, src]);

  // A turn that ended may have changed what the page shows.
  const previous = useRef(session.state);
  useEffect(() => {
    const was = previous.current;
    previous.current = session.state;
    if ((was === "running" || was === "forking") && session.state !== "running" && session.state !== "forking" && src) reload();
  }, [session.state]);

  const copy = async () => {
    await navigator.clipboard.writeText(where.path);
    toast({ kind: "success", message: t("preview.copied", { path: where.path }) });
  };

  // Once a page is in the frame it stays: a status check that fails while the app recompiles does not unmount it.
  const ready = Boolean(token && src);
  if (!ready)
    return error || status.isError ? (
      <Empty
        icon="preview"
        title={t("preview.failed")}
        text={error ?? messageFrom(status.error, t)}
        action={
          <Button glyph="restore" onClick={again}>
            {t("preview.retry")}
          </Button>
        }
      />
    ) : (
      <Empty
        icon="preview"
        title={t(status.data ? "preview.starting" : "preview.waking")}
        text={
          status.data
            ? `${t("preview.starting_body")}${status.data.status ? ` (${t("preview.answered", { status: status.data.status })})` : status.data.error ? ` (${status.data.error})` : ""}`
            : t("preview.waking_body")
        }
      />
    );
  return (
    <Frame
      key={round}
      ref={frame}
      src={src!}
      title={t("preview.title")}
      sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals allow-downloads"
      onLoad={settled}
      bar={
        <Address
          url={origin + where.path}
          parts={{
            home: { label: t("preview.home"), title: t("preview.home"), onClick: () => home() },
            back: { label: t("preview.back"), title: t("preview.back"), disabled: !canBack, onClick: () => step(-1) },
            forward: { label: t("preview.forward"), title: t("preview.forward"), disabled: !canForward, onClick: () => step(1) },
            reload: { label: t("preview.reload"), title: t("preview.reload"), onClick: reload },
            form: {
              onSubmit: (e) => {
                e.preventDefault();
                if (typed !== undefined) navigate(typed);
                setTyped(undefined);
                (document.activeElement as HTMLElement | null)?.blur();
              },
            },
            url: {
              value: typed ?? origin + where.path,
              title: where.title,
              onChange: (e) => setTyped(e.target.value),
              onKeyDown: (e) => {
                if (e.key === "Escape") {
                  setTyped(undefined);
                  e.currentTarget.blur();
                }
              },
            },
            go: { title: t("preview.go") },
            copy: { label: t("preview.copy"), title: t("preview.copy"), onClick: copy },
          }}
        />
      }
    />
  );
}
