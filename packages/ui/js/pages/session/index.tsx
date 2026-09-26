import { lazy, Suspense } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { isAxiosError } from "axios";
import { useTranslations } from "@/contexts/i18n";
import { messageFrom } from "@/contexts/api/errors";
import { useEnvironments, useSession } from "@/contexts/api/sessions";
import type { Session } from "@/contexts/api/types";
import { Shell } from "@/shell/shell";
import { Button } from "@/ds/button";
import { Empty } from "@/ds/empty";
import { Head } from "@/ds/head";
import { Inline } from "@/ds/inline";
import { Page } from "@/ds/page";
import { Segmented } from "@/ds/segmented";
import { Skeleton } from "@/ds/skeleton";
import { Chat } from "@/pages/session/chat";
import { Logs } from "@/pages/session/logs";
import { Preview } from "@/pages/session/preview";

const Changes = lazy(() => import("@/pages/session/changes").then((m) => ({ default: m.Changes })));
const Terminals = lazy(() => import("@/pages/session/terminal").then((m) => ({ default: m.Terminals })));

const VIEWS = ["chat", "preview", "changes", "terminal"] as const;
type View = (typeof VIEWS)[number];
const GLYPHS: Record<View, string> = { chat: "chat", preview: "window", changes: "diff", terminal: "terminal" };

export function title(s: Session, fallback: string) {
  return s.title ?? s.events.find((e) => e.kind === "prompt")?.content ?? s.pending ?? fallback;
}

// A session, as vrcl's: the bar (repository, title over branch, the view switch), then the view.
export function SessionPage() {
  const { id, view: raw } = useParams() as { id: string; view?: string };
  const view: View = VIEWS.includes(raw as View) ? (raw as View) : "chat";
  const { t } = useTranslations();
  const session = useSession(id);
  const envs = useEnvironments();
  const [params, setParams] = useSearchParams();
  const env = envs.data?.find((e) => e.name === session.data?.env);
  const [owner, repo] = env?.repo.includes("/") ? env.repo.split("/") : ["", env?.repo ?? session.data?.env ?? ""];
  const logs = params.get("logs");
  const setLogs = (name?: string) => {
    const next = new URLSearchParams(params);
    if (name) next.set("logs", name);
    else next.delete("logs");
    setParams(next);
  };
  const missing = session.isError && isAxiosError(session.error) && session.error.response?.status === 404;

  const head = (
    <Head
      title={session.data ? title(session.data, t("session.untitled")) : ""}
      subtitle={session.data?.branch}
      centre
      back="/"
      backLabel={t("session.all")}
      place={{ name: repo, owner: owner || undefined }}
      action={
        <Inline gap={8}>
          <Button variant="ghost" glyph="server" label={t("logs.title")} title={t("logs.title")} disabled={!session.data} onClick={() => setLogs("setup")} />
          <Segmented
            label={t("session.views")}
            value={view}
            glyphOnly
            items={VIEWS.map((v) => ({ value: v, label: t(`views.${v}`), glyph: GLYPHS[v], href: v === "chat" ? `/s/${id}` : `/s/${id}/${v}` }))}
          />
        </Inline>
      }
    />
  );

  return (
    <Shell rail place="session">
      {session.data && view === "chat" ? (
        <Chat session={session.data} env={env} head={head} />
      ) : (
        <Page layout="column" width={view === "changes" ? 800 : "narrow"} flush={view === "preview" || view === "terminal"} head={head}>
          {session.isPending && <Skeleton shape="page" />}
          {session.isError && (
            <Empty
              icon="session"
              title={missing ? t("session.missing") : messageFrom(session.error, t)}
              action={
                <Button href="/" glyph="arrow-left">
                  {t("session.all")}
                </Button>
              }
            />
          )}
          {session.data && view === "preview" && <Preview session={session.data} host={session.data.preview} />}
          <Suspense fallback={null}>
            {session.data && view === "changes" && <Changes session={id} />}
            {session.data && view === "terminal" && <Terminals session={id} />}
          </Suspense>
        </Page>
      )}
      {session.data && logs && (
        <Logs session={id} name={logs} subtitle={`${session.data.env} · ${session.data.branch}`} onPick={setLogs} onClose={() => setLogs()} />
      )}
    </Shell>
  );
}
