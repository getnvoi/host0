import { lazy, Suspense } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { isAxiosError } from "axios";
import { CircleAlert, GitBranch, MessagesSquare, Server } from "lucide-react";
import { useTranslations } from "@/contexts/i18n";
import { messageFrom } from "@/contexts/api/errors";
import { useEnvironments, useSession } from "@/contexts/api/sessions";
import type { Session } from "@/contexts/api/types";
import { Empty, Skeleton } from "@/ui/bits";
import { Face } from "@/ui/marks";
import { Shell, SideButton } from "@/shell/shell";
import { Chat } from "@/pages/session/chat";
import { Logs } from "@/pages/session/logs";
import { Preview } from "@/pages/session/preview";

const Changes = lazy(() => import("@/pages/session/changes").then((m) => ({ default: m.Changes })));
const Terminals = lazy(() => import("@/pages/session/terminal").then((m) => ({ default: m.Terminals })));

const VIEWS = ["chat", "preview", "changes", "terminal"] as const;
type View = (typeof VIEWS)[number];

export function title(s: Session, fallback: string) {
  return s.title ?? s.events.find((e) => e.kind === "prompt")?.content ?? s.pending ?? fallback;
}

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

  return (
    <Shell rail place="session">
      <header className="bar">
        <div className="bar-lead">
          <SideButton />
          <Face icon={GitBranch} family="green" size={28} />
          <span className="repo">
            {owner && <small>{owner}</small>}
            <b>{repo}</b>
          </span>
        </div>
        <div className="bar-mid">
          <h1 className="bar-title">{session.data ? title(session.data, t("session.untitled")) : ""}</h1>
          {session.data && <small>{session.data.branch}</small>}
        </div>
        <div className="bar-end">
          <button type="button" className="btn ghost logs-btn" title={t("logs.open")} onClick={() => setLogs("setup")} disabled={!session.data}>
            <Server />
            <span>{t("logs.title")}</span>
          </button>
          <nav className="seg" aria-label={t("session.views")}>
            {VIEWS.map((v) => (
              <Link key={v} to={v === "chat" ? `/s/${id}` : `/s/${id}/${v}`} aria-current={view === v ? "page" : undefined}>
                <span>{t(`views.${v}`)}</span>
              </Link>
            ))}
          </nav>
        </div>
      </header>
      {session.isPending && (
        <div className="transcript">
          <Skeleton />
        </div>
      )}
      {session.isError && (
        <div className="center">
          <Empty
            icon={missing ? MessagesSquare : CircleAlert}
            family={missing ? "blue" : "orange"}
            title={missing ? t("session.missing") : messageFrom(session.error, t)}
            dashed={false}
            action={
              <Link className="btn outline" to="/">
                {t("session.all")}
              </Link>
            }
          />
        </div>
      )}
      {session.data && view === "chat" && <Chat session={session.data} env={env} />}
      {session.data && view === "preview" && <Preview session={session.data} host={session.data.preview} />}
      <Suspense fallback={null}>
        {session.data && view === "changes" && <Changes session={id} />}
        {session.data && view === "terminal" && <Terminals session={id} />}
      </Suspense>
      {session.data && logs && (
        <Logs session={id} name={logs} subtitle={`${session.data.env} · ${session.data.branch}`} onPick={setLogs} onClose={() => setLogs()} />
      )}
    </Shell>
  );
}
