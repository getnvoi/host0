import { Link, useSearchParams } from "react-router-dom";
import { Columns3, List, MessagesSquare, Plus, Search } from "lucide-react";
import { useTranslations, type TFunction } from "@/contexts/i18n";
import { messageFrom } from "@/contexts/api/errors";
import { useApprovals, useEnvironments, useSessions } from "@/contexts/api/sessions";
import type { Approval, Environment, Summary } from "@/contexts/api/types";
import { byDay } from "@/lib/days";
import { LANES, lane } from "@/lib/lanes";
import { age, full } from "@/lib/time";
import { Alert, Empty, Skeleton } from "@/ui/bits";
import { Dot, Face, StateDot, Tile, useToolLabel } from "@/ui/marks";
import { Shell, SideButton, useNewSession } from "@/shell/shell";
import { CircleAlert } from "lucide-react";

export function HomePage() {
  const { t } = useTranslations();
  const [params, setParams] = useSearchParams();
  const board = params.get("view") === "board";
  const q = params.get("q") ?? "";
  const sessions = useSessions();
  const create = useNewSession();
  const view = (b: boolean) => {
    const next = new URLSearchParams(params);
    if (b) next.set("view", "board");
    else next.delete("view");
    return `/?${next}`;
  };
  const shown = (sessions.data ?? []).filter((s) => !q || `${s.title ?? ""} ${s.prompt} ${s.env}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <Shell rail={false} place="home">
      <header className="bar">
        <div className="bar-lead">
          <SideButton />
          <Face icon={MessagesSquare} family="blue" size={28} />
          <h1 className="bar-title">{t("home.title")}</h1>
          {sessions.data && sessions.data.length > 0 && <span className="count">{sessions.data.length}</span>}
        </div>
        <label className="search">
          <Search />
          <input
            type="search"
            value={q}
            placeholder={t("home.search")}
            aria-label={t("home.search")}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.value) next.set("q", e.target.value);
              else next.delete("q");
              setParams(next, { replace: true });
            }}
          />
        </label>
        <div className="bar-end">
          <nav className="seg" aria-label={t("home.view")}>
            <Link to={view(false)} aria-current={!board ? "page" : undefined}>
              <List />
              <span>{t("home.list")}</span>
            </Link>
            <Link to={view(true)} aria-current={board ? "page" : undefined}>
              <Columns3 />
              <span>{t("home.board")}</span>
            </Link>
          </nav>
          <button type="button" className="btn outline" onClick={create}>
            <Plus />
            {t("session.new")}
          </button>
        </div>
      </header>
      <div className="page-scroll">
        {sessions.isPending && (
          <div className="column">
            <Skeleton rows={5} />
          </div>
        )}
        {sessions.isError && (
          <div className="column">
            <Alert icon={CircleAlert} title={messageFrom(sessions.error, t)} />
          </div>
        )}
        {sessions.isSuccess && sessions.data.length === 0 && (
          <div className="column">
            <Empty
              icon={MessagesSquare}
              family="blue"
              title={t("home.empty_title")}
              text={t("home.empty_body")}
              action={
                <button type="button" className="btn solid" onClick={create}>
                  <Plus />
                  {t("session.new")}
                </button>
              }
            />
          </div>
        )}
        {sessions.isSuccess && sessions.data.length > 0 && shown.length === 0 && (
          <div className="column">
            <Empty icon={Search} title={t("home.no_match", { q })} action={<Link className="btn ghost" to={board ? "/?view=board" : "/"}>{t("home.clear")}</Link>} />
          </div>
        )}
        {shown.length > 0 && (board ? <Board sessions={shown} /> : <Days sessions={shown} />)}
      </div>
    </Shell>
  );
}

function dayLabel(age: number, key: string, t: TFunction) {
  if (age === 0) return t("days.today");
  if (age === 1) return t("days.yesterday");
  if (age < 7) return t("days.ago", { count: age });
  return new Date(key).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function useRepos() {
  const envs = useEnvironments();
  const map = new Map<string, Environment>((envs.data ?? []).map((e) => [e.name, e]));
  return (env: string) => map.get(env);
}

// The environment's name when it says more than the repository's; its size otherwise.
function envBadge(name: string, env?: Environment) {
  if (!env || env.repo.replace(/^.*\//, "") !== name) return name;
  return env.tier || "medium";
}

function Days({ sessions }: { sessions: Summary[] }) {
  const { t } = useTranslations();
  const repo = useRepos();
  return (
    <div className="column">
      {byDay(sessions).map((day) => (
        <section key={day.key} className="day" aria-label={dayLabel(day.age, day.key, t)}>
          <h2 className="tab">
            {dayLabel(day.age, day.key, t)} <span className="count">{day.sessions.length}</span>
          </h2>
          <div className="rows">
            {day.sessions.map((s) => (
              <Link key={s.id} to={`/s/${s.id}`} className="row">
                <StateDot state={s.state} />
                <span className="t">{s.title ?? s.prompt}</span>
                <span className="caption truncate">{repo(s.env)?.repo.replace(/^.*\//, "") ?? s.env}</span>
                <span className="badge kind">{envBadge(s.env, repo(s.env))}</span>
                <time className="meta age" dateTime={s.last} title={full(s.last)}>
                  {age(s.last)}
                </time>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Board({ sessions }: { sessions: Summary[] }) {
  const { t } = useTranslations();
  const repo = useRepos();
  const approvals = useApprovals();
  const label = useToolLabel();
  return (
    <div className="lanes">
      {LANES.map((l) => {
        const here = sessions.filter((s) => lane(s) === l);
        return (
          <section key={l} className="lane" aria-label={t(`lanes.${l}`)}>
            <h2 className="tab">
              {t(`lanes.${l}`)} <span className="count">{here.length}</span>
            </h2>
            <div className="rows">
              {here.length === 0 && <span className="lane-empty">{t("lanes.none")}</span>}
              {here.map((s) => {
                const r = repo(s.env)?.repo ?? s.env;
                const [owner, name] = r.includes("/") ? r.split("/") : ["", r];
                return (
                  <Link key={s.id} to={`/s/${s.id}`} className="card">
                    <span className="ct">{s.title ?? s.prompt}</span>
                    <Why s={s} approvals={approvals.data ?? []} label={label} t={t} />
                    <span className="cw">
                      <Tile name={name} size={20} />
                      <span className="cn">
                        {owner && <span>{owner} / </span>}
                        {name}
                      </span>
                      <time className="meta" dateTime={s.last} title={full(s.last)}>
                        {age(s.last)}
                      </time>
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// Why a card sits in its lane; an idle card needs no reason.
function Why({ s, approvals, label, t }: { s: Summary; approvals: Approval[]; label: (n: string) => string; t: TFunction }) {
  const queued = s.queued > 0 ? ` · ${t("home.queued", { count: s.queued })}` : "";
  switch (s.state) {
    case "forking":
    case "running":
      return (
        <span className="cs">
          <span className="spin" />
          <span>{t(s.state === "forking" ? "session.forking" : "state.running") + queued}</span>
        </span>
      );
    case "awaiting_approval": {
      const a = approvals.find((x) => x.session === s.id);
      return (
        <span className="cs">
          <Dot tone="busy" />
          <span>{a ? label(a.tool) : t("state.awaiting_approval")}</span>
        </span>
      );
    }
    case "failed":
      return (
        <span className="cs">
          <Dot tone="bad" />
          <span>{s.error?.split("\n")[0] ?? t("state.failed")}</span>
        </span>
      );
    default:
      return queued ? <span className="cs">{queued.slice(3)}</span> : null;
  }
}
