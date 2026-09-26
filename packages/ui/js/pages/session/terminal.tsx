import { useEffect, useRef, useState } from "react";

import { Plus, SquareTerminal, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useTranslations } from "@/contexts/i18n";
import { messageFrom } from "@/contexts/api/errors";
import { killTerminal, terminalsKey, useTerminals } from "@/contexts/api/sessions";
import { Empty, Skeleton } from "@/ui/bits";
import { Dot } from "@/ui/marks";
import { backoff } from "@/lib/backoff";
import { watchAway } from "@/lib/away";
import { notify } from "@/ui/toast";

// closed: boxd refused or ended the shell (a close code of 4000 and up). lost: retries ran out. paused: the page was
// hidden for a minute and let the socket go.
type Link = "connecting" | "open" | "reconnecting" | "exited" | "closed" | "lost" | "paused";

// Connection attempts in a row before the tab stops trying on its own.
const TRIES = 8;

const fresh = () => `sh-${Math.random().toString(36).slice(2, 8)}`;

// Shells in the sandbox. A tab closed in the page only detaches; the shell runs on and its scrollback comes back.
export function Terminals({ session }: { session: string }) {
  const { t } = useTranslations();
  const client = useQueryClient();
  const list = useTerminals(session);
  const [local, setLocal] = useState<string[]>([]);
  const [active, setActive] = useState<string>();
  const [gone, setGone] = useState<string[]>([]);
  const server = (list.data ?? []).map((x) => x.id);
  const tabs = [...server, ...local.filter((id) => !server.includes(id))].filter((id) => !gone.includes(id));

  const started = useRef(false);
  useEffect(() => {
    if (!list.isSuccess) return;
    // One shell is opened for an empty page, once: a shell that exits at once is not started again.
    if (tabs.length === 0 && !started.current) {
      started.current = true;
      const id = fresh();
      setLocal((l) => [...l, id]);
      setActive(id);
    } else if (!active || !tabs.includes(active)) setActive(tabs[0]);
  }, [list.isSuccess, tabs.join(","), active]);

  const open = () => {
    const id = fresh();
    setLocal((l) => [...l, id]);
    setActive(id);
  };
  const close = async (id: string) => {
    setGone((g) => [...g, id]);
    try {
      await killTerminal(session, id);
    } catch (e) {
      // The shell still runs: its tab comes back.
      setGone((g) => g.filter((x) => x !== id));
      notify.error(messageFrom(e, t));
    }
    client.invalidateQueries({ queryKey: terminalsKey(session) });
  };
  const exited = (id: string) => {
    setGone((g) => [...g, id]);
    client.invalidateQueries({ queryKey: terminalsKey(session) });
  };

  if (list.isPending)
    return (
      <div className="column">
        <Skeleton />
      </div>
    );
  return (
    <div className="page-flush">
      <div className="terms" role="tablist" aria-label={t("terminal.tabs")}>
        {tabs.map((id, i) => (
          <span key={id} className="term-tab" role="tab" aria-selected={active === id} aria-current={active === id}>
            <button type="button" onClick={() => setActive(id)}>
              {(list.data?.find((x) => x.id === id)?.command ?? "bash").replace(/^.*\//, "").split(" ")[0]}
              {i > 0 ? ` ${i + 1}` : ""}
            </button>
            <button type="button" className="btn ghost sm icon" aria-label={t("terminal.close")} title={t("terminal.close")} onClick={() => close(id)}>
              <X />
            </button>
          </span>
        ))}
        <button type="button" className="btn ghost sm icon" aria-label={t("terminal.new")} title={t("terminal.new")} onClick={open}>
          <Plus />
        </button>
      </div>
      {active && tabs.includes(active) ? (
        <Shell key={active} session={session} id={active} onExit={() => exited(active)} />
      ) : (
        <div className="center">
          <Empty
            icon={SquareTerminal}
            family="orange"
            title={t("terminal.empty")}
            dashed={false}
            action={
              <button type="button" className="btn outline" onClick={open}>
                <Plus />
                {t("terminal.new")}
              </button>
            }
          />
        </div>
      )}
    </div>
  );
}

function css(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function theme(): ITheme {
  const dark = css("color-scheme") === "dark";
  const ink = css("--term-ink");
  return {
    background: css("--term-bg"),
    foreground: ink,
    cursor: ink,
    cursorAccent: css("--term-bg"),
    selectionBackground: dark ? "#3a4a5f" : "#cfe0f3",
    black: dark ? "#3a3935" : "#2c2a26",
    red: dark ? "#f2787c" : "#c53b40",
    green: dark ? "#7fcf9b" : "#3f8a5f",
    yellow: dark ? "#e8c26a" : "#a07a1b",
    blue: dark ? "#8ab4e8" : "#4a7fc1",
    magenta: dark ? "#d99ac4" : "#9a4a82",
    cyan: dark ? "#7fcfc4" : "#2f8a80",
    white: dark ? "#e9e6df" : "#8a877f",
    brightBlack: dark ? "#6f6c65" : "#6b6a62",
    brightRed: dark ? "#ff9ca0" : "#e5484d",
    brightGreen: dark ? "#a3e5b9" : "#30a46c",
    brightYellow: dark ? "#f5d68f" : "#c28e0e",
    brightBlue: dark ? "#aecbf2" : "#3e6fb0",
    brightMagenta: dark ? "#ebb8da" : "#b35a98",
    brightCyan: dark ? "#a3e5dc" : "#23998c",
    brightWhite: dark ? "#ffffff" : "#1f1e1a",
  };
}

function Shell({ session, id, onExit }: { session: string; id: string; onExit: () => void }) {
  const { t } = useTranslations();
  const host = useRef<HTMLDivElement>(null);
  const [link, setLink] = useState<Link>("connecting");
  const [reason, setReason] = useState("");
  const retry = useRef<() => void>(undefined);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const term = new XTerm({
      fontFamily: css("--mono") || "monospace",
      fontSize: 12.5,
      lineHeight: 1.35,
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true,
      theme: theme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(el);
    fit.fit();
    term.focus();
    // Cells are measured with the font in use; once the webfont arrives they are measured again.
    document.fonts.ready.then(() => {
      if (done) return;
      term.options.fontFamily = css("--mono") || "monospace";
      fit.fit();
    });

    let ws: WebSocket | undefined;
    let done = false;
    let paused = false;
    let tries = 0;
    // Keys typed before the socket opens go out once it does, up to a screenful.
    let held: Uint8Array[] = [];
    const send = (b: Uint8Array) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(b);
      else if (held.reduce((n, h) => n + h.length, 0) < 4096) held.push(b);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const encoder = new TextEncoder();

    const resize = () => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };
    const connect = () => {
      clearTimeout(timer);
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const self = new WebSocket(`${proto}://${location.host}/api/sessions/${session}/terminals/${id}?cols=${term.cols}&rows=${term.rows}`);
      ws = self;
      self.binaryType = "arraybuffer";
      let first = true;
      self.onopen = () => {
        tries = 0;
        setLink("open");
        resize();
        for (const b of held) self.send(b);
        held = [];
      };
      self.onmessage = (e) => {
        if (typeof e.data === "string") {
          try {
            const msg = JSON.parse(e.data) as { type: string; code?: number };
            if (msg.type === "exit") {
              done = true;
              setLink("exited");
              term.write(`\r\n\x1b[2m${t("terminal.exited", { code: msg.code ?? 0 })}\x1b[0m\r\n`);
              setTimeout(onExit, 1200);
            }
          } catch {
            term.write(e.data);
          }
          return;
        }
        // The first message after a connect is the scrollback: it replaces what the page shows.
        if (first) {
          term.reset();
          first = false;
        }
        term.write(new Uint8Array(e.data as ArrayBuffer));
      };
      self.onclose = (e) => {
        // A socket let go on purpose, or replaced by a newer one, says nothing about the shell.
        if (done || paused || ws !== self) return;
        // boxd closes with 4000 and up when the shell cannot start or has exited: another try would end the same.
        if (e.code >= 4000) {
          done = true;
          setReason(e.reason);
          setLink("closed");
          term.write(`\r\n\x1b[2m${e.reason || t("terminal.ended")}\x1b[0m\r\n`);
          return;
        }
        if (tries >= TRIES) {
          setLink("lost");
          return;
        }
        setLink("reconnecting");
        timer = setTimeout(connect, backoff(tries++, 500, 8000));
      };
    };
    connect();
    retry.current = () => {
      if (done) return;
      tries = 0;
      setLink("connecting");
      connect();
    };
    const away = watchAway(60_000, {
      away: () => {
        if (done) return;
        paused = true;
        clearTimeout(timer);
        ws?.close();
        setLink("paused");
      },
      back: () => {
        paused = false;
        if (done) return;
        tries = 0;
        setLink("reconnecting");
        connect();
      },
    });

    const input = term.onData((d) => send(encoder.encode(d)));
    const binary = term.onBinary((d) => send(Uint8Array.from(d, (c) => c.charCodeAt(0))));
    const sized = term.onResize(resize);
    const ro = new ResizeObserver(() => fit.fit());
    ro.observe(el);
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    const retheme = () => (term.options.theme = theme());
    scheme.addEventListener("change", retheme);
    const themed = new MutationObserver(retheme);
    themed.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      done = true;
      clearTimeout(timer);
      away();
      ro.disconnect();
      themed.disconnect();
      scheme.removeEventListener("change", retheme);
      input.dispose();
      binary.dispose();
      sized.dispose();
      ws?.close();
      term.dispose();
    };
  }, [session, id]);

  return (
    <>
      {link !== "open" && (
        <div className="previewbar" aria-live="polite">
          {link === "exited" || link === "closed" || link === "lost" || link === "paused" ? <Dot tone={link === "lost" ? "bad" : "idle"} /> : <span className="spin" />}
          <span className="grow" style={{ fontFamily: "var(--sans)" }}>
            {link === "exited"
              ? t("terminal.ended")
              : link === "closed"
                ? reason
                  ? t("terminal.closed", { reason })
                  : t("terminal.ended")
                : t(`terminal.${link}`)}
          </span>
          {link === "lost" && (
            <button type="button" className="btn ghost sm" onClick={() => retry.current?.()}>
              {t("terminal.retry")}
            </button>
          )}
        </div>
      )}
      <div className="term">
        <div ref={host} />
      </div>
    </>
  );
}
