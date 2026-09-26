import { useSearchParams } from "react-router-dom";
import { useTranslations, type TFunction } from "@/contexts/i18n";
import { messageFrom } from "@/contexts/api/errors";
import { useApprovals, useEnvironments, useSessions } from "@/contexts/api/sessions";
import type { Approval, Environment, Summary } from "@/contexts/api/types";
import { byDay } from "@/lib/days";
import { LANES, lane } from "@/lib/lanes";
import { age, full } from "@/lib/time";
import { useToolLabel } from "@/ui/marks";
import { Shell, useNewSession } from "@/shell/shell";
import { Alert } from "@/ds/alert";
import { Badge } from "@/ds/badge";
import { Board, BoardCard, BoardLane } from "@/ds/board";
import { Button } from "@/ds/button";
import { Empty } from "@/ds/empty";
import { Head } from "@/ds/head";
import { List, ListCell, ListName, ListRow } from "@/ds/list";
import { Page } from "@/ds/page";
import { Place } from "@/ds/place";
import { Section } from "@/ds/section";
import { Segmented } from "@/ds/segmented";
import { Skeleton } from "@/ds/skeleton";
import { Stack } from "@/ds/stack";

// Sessions, as vrcl's home: a narrow column of day sections, or the board with its lanes edge to edge.
export function HomePage() {
  const { t } = useTranslations();
  const [params, setParams] = useSearchParams();
  const board = params.get("view") === "board";
  const q = params.get("q") ?? "";
  const sessions = useSessions();
  const create = useNewSession();
  const all = sessions.data ?? [];
  const shown = all.filter((s) => !q || `${s.title ?? ""} ${s.prompt} ${s.env}`.toLowerCase().includes(q.toLowerCase()));
  const search = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set("q", value);
    else next.delete("q");
    setParams(next, { replace: true });
  };
  const view = (b: boolean) => {
    const next = new URLSearchParams(params);
    if (b) next.set("view", "board");
    else next.delete("view");
    return `/?${next}`;
  };
  const any = all.length > 0;

  return (
    <Shell rail={false} place="home">
      <Page
        layout={board ? "list" : "column"}
        width="narrow"
        head={
          <Head
            title={t("home.title")}
            icon="session"
            count={any ? all.length : undefined}
            form={any ? "/" : undefined}
            formAttrs={{
              onSubmit: (e) => {
                e.preventDefault();
                search((e.currentTarget.elements.namedItem("q") as HTMLInputElement | null)?.value ?? "");
              },
            }}
            search={any ? { placeholder: t("home.search"), value: q, attrs: { onChange: (e) => search(e.target.value) } } : undefined}
            filters={
              any && (
                <Segmented
                  label={t("home.view")}
                  value={board ? "board" : "list"}
                  items={[
                    { value: "list", label: t("home.list"), glyph: "list", href: view(false) },
                    { value: "board", label: t("home.board"), glyph: "board", href: view(true) },
                  ]}
                />
              )
            }
            action={
              <Button glyph="plus" onClick={create}>
                {t("session.new")}
              </Button>
            }
          />
        }
      >
        {sessions.isPending && <Skeleton shape="list" rows={5} />}
        {sessions.isError && <Alert tone="error" title={messageFrom(sessions.error, t)} />}
        {sessions.isSuccess &&
          (shown.length === 0 ? (
            <List columns={[t("home.title")]} label={t("home.title")}
              empty={
                !any ? (
                  <Empty
                    icon="session"
                    heading="h3"
                    title={t("home.empty_title")}
                    text={t("home.empty_body")}
                    action={
                      <Button variant="solid" glyph="plus" onClick={create}>
                        {t("session.new")}
                      </Button>
                    }
                  />
                ) : (
                  <Empty icon="session" heading="h3" filtered text={t("home.no_match", { q })} clear={board ? "/?view=board" : "/"} clearLabel={t("home.clear")} />
                )
              }
            />
          ) : board ? (
            <Lanes sessions={shown} />
          ) : (
            <Days sessions={shown} />
          ))}
      </Page>
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

const STATE: Record<Summary["state"], "ok" | "busy" | "bad" | "idle"> = {
  forking: "busy",
  running: "busy",
  awaiting_approval: "busy",
  idle: "ok",
  failed: "bad",
};

function split(repo: string) {
  const [owner, name] = repo.includes("/") ? repo.split("/") : ["", repo];
  return { owner, name };
}

function When({ at }: { at: string }) {
  return (
    <time dateTime={at} title={full(at)}>
      {age(at)}
    </time>
  );
}

// One section per day: a dense list of state, title, repository, environment and age.
function Days({ sessions }: { sessions: Summary[] }) {
  const { t } = useTranslations();
  const repo = useRepos();
  return (
    <Stack gap={24}>
      {byDay(sessions).map((day) => {
        const label = dayLabel(day.age, day.key, t);
        return (
          <Section key={day.key} name={label} count={day.sessions.length} flush>
            <List columns={[t("home.title"), "", "", ["", "end"]]} template="minmax(0, 1fr) 140px 110px 40px" head={false} dense label={label}>
              {day.sessions.map((s) => {
                const { owner, name } = split(repo(s.env)?.repo ?? s.env);
                return (
                  <ListRow
                    key={s.id}
                    href={`/s/${s.id}`}
                    name={<ListName title={s.title ?? s.prompt} state={[STATE[s.state], t(`state.${s.state}`)]} />}
                    cells={
                      <>
                        <ListCell>
                          <Place name={name} owner={owner || undefined} />
                        </ListCell>
                        <ListCell>
                          <Badge kind>{s.env}</Badge>
                        </ListCell>
                        <ListCell align="end">
                          <When at={s.last} />
                        </ListCell>
                      </>
                    }
                  />
                );
              })}
            </List>
          </Section>
        );
      })}
    </Stack>
  );
}

// One lane per state; a card per session with what it is doing.
function Lanes({ sessions }: { sessions: Summary[] }) {
  const { t } = useTranslations();
  const repo = useRepos();
  const approvals = useApprovals();
  const label = useToolLabel();
  return (
    <Board aria-label={t("home.board")}>
      {LANES.map((l) => {
        const here = sessions.filter((s) => lane(s) === l);
        return (
          <BoardLane key={l} name={t(`lanes.${l}`)} count={here.length} empty={t("lanes.none")}>
            {here.map((s) => {
              const { owner, name } = split(repo(s.env)?.repo ?? s.env);
              const state = STATE[s.state];
              return (
                <BoardCard
                  key={s.id}
                  title={s.title ?? s.prompt}
                  href={`/s/${s.id}`}
                  state={state === "idle" ? undefined : state}
                  status={doing(s, approvals.data ?? [], label, t)}
                  spin={s.state === "running" || s.state === "forking"}
                  place={name}
                  scope={owner || undefined}
                  badge={s.env}
                  time={<When at={s.last} />}
                />
              );
            })}
          </BoardLane>
        );
      })}
    </Board>
  );
}

// What a card's session is doing; an idle one needs no word.
function doing(s: Summary, approvals: Approval[], label: (n: string) => string, t: TFunction) {
  const queued = s.queued > 0 ? t("home.queued", { count: s.queued }) : "";
  switch (s.state) {
    case "forking":
    case "running":
      return [t(s.state === "forking" ? "session.forking" : "state.running"), queued].filter(Boolean).join(" · ");
    case "awaiting_approval": {
      const a = approvals.find((x) => x.session === s.id);
      return a ? label(a.tool) : t("state.awaiting_approval");
    }
    case "failed":
      return s.error?.split("\n")[0] ?? t("state.failed");
    default:
      return queued || undefined;
  }
}
