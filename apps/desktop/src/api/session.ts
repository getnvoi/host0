// The plane's sessions as the screens take them. The plane keeps a session's events in one list, a `prompt` opening
// each turn; the screens read turns, each with its events, and a waiting approval as a call in the last one.
import type { AgentRecord, EnvironmentChoice, EventRecord, PullRequestRecord, RepoRecord, SessionRecord, TurnRecord } from "@hz/ui";
import { request } from "./client";
import type { Approval, Changes, EnvironmentSummary, Event, LlmConfig, Provider, Session, State, Summary } from "./models";

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// The name of a session wherever it shows (a tab, a list, the commander): its title, else its first prompt.
export const sessionTitle = (s: { title?: string | null; prompt?: string }) => (s.title?.trim() ? s.title : s.prompt?.trim() ? s.prompt.slice(0, 80) : "Untitled session");

// `waiting` for a call that waits on a person; the machine's state from the fork.
const status = (s: State) => (s === "awaiting_approval" ? "waiting" : s === "forking" || s === "running" ? "running" : "idle");
const machine = (s: State) => (s === "forking" ? "starting" : s === "failed" ? "failed" : "running");

export function sessionOf(s: Summary | Session, environments: EnvironmentSummary[] = []): SessionRecord {
  const env = environments.find((e) => e.name === s.env);
  return {
    id: s.id,
    title: sessionTitle({ title: s.title, prompt: "prompt" in s ? s.prompt : (s.events.find((e) => e.kind === "prompt")?.content ?? "") }),
    status: status(s.state),
    archived: false,
    agentId: "",
    repoId: env?.repo ?? "",
    environmentId: s.env,
    worktree: { id: s.id, repoId: env?.repo ?? "", environmentId: s.env, branch: s.branch, state: machine(s.state), hostname: s.preview, serving: false, createdAt: s.at },
    createdAt: s.at,
    updatedAt: s.last,
  };
}

// The pull request the agent opened: the plane writes each decided call's outcome into the prompt after it, and
// create_pull_request's reads `create_pull_request: opened <url>`. `changed`: the files `sessions/{id}/changes` lists.
export function pullRequestOf(s: Session, changed: number): PullRequestRecord {
  let url: string | undefined;
  for (const e of s.events) if (e.kind === "prompt") for (const m of (e.content ?? "").matchAll(/^create_pull_request: opened (\S+)$/gm)) url = m[1];
  return url ? { url, state: "open", changed } : { changed };
}

// The environments grouped by the repository they check out: the screens pick a repository, then its environment.
export function reposOf(environments: EnvironmentSummary[]): RepoRecord[] {
  const out: RepoRecord[] = [];
  for (const e of environments) {
    const repo = out.find((r) => r.id === e.repo) ?? out[out.push({ id: e.repo, name: e.repo, owner: e.repo.split("/")[0] ?? "", defaultBranch: e.branch, environments: [] }) - 1];
    repo.environments.push({ id: e.name, name: e.name, providerName: e.tier });
  }
  return out;
}

export const choicesOf = (environments: EnvironmentSummary[]): EnvironmentChoice[] =>
  environments.filter((e) => e.ready).map((e) => ({ id: e.name, name: e.name, repositories: [e.repo] }));

// The agent a session runs: the plane runs every turn on the main credential, so that one is the only choice.
export function agentsOf(configs: LlmConfig[], providers: Provider[]): AgentRecord[] {
  return configs
    .filter((c) => c.main && !c.archived_at)
    .map((c) => ({ id: c.name, name: providers.find((p) => p.key === c.provider)?.label ?? c.provider, slug: c.provider, tagline: c.name, model: c.values.model ?? null }));
}

// A turn's state from where it stands: the last follows the session, the earlier ones ended.
function ended(events: Event[]) {
  const last = events[events.length - 1];
  return last?.kind === "stopped" ? "cancelled" : last?.kind === "error" ? "failed" : "succeeded";
}

function live(s: Session, events: Event[]) {
  switch (s.state) {
    case "forking":
      return "pending";
    case "running":
      return "running";
    case "awaiting_approval":
      return "awaiting_approval";
    case "failed":
      return "failed";
    default:
      return ended(events);
  }
}

const eventOf = (turn: string, i: number, e: Event, at: string): EventRecord => ({
  id: `${turn}-${i}`,
  kind: e.kind,
  content: e.content ?? "",
  tool: e.tool,
  toolUseId: e.tool_id,
  parentToolUseId: e.parent,
  durationMs: e.meta?.duration_ms,
  createdAt: e.at ?? at,
});

// The turns of a session, its waiting calls in the last, then the messages queued behind it.
export function turnsOf(s: Session, approvals: Approval[], queue: string[]): TurnRecord[] {
  const turns: { prompt: string; at: string; events: Event[] }[] = [];
  for (const e of s.events) {
    if (e.kind === "prompt") turns.push({ prompt: e.content ?? "", at: e.at ?? s.at, events: [] });
    else if (turns.length) turns[turns.length - 1].events.push(e);
    else turns.push({ prompt: "", at: e.at ?? s.at, events: [e] });
  }
  // The first prompt is held until the fork is made.
  if (s.pending && !turns.length) turns.push({ prompt: s.pending, at: s.at, events: [] });
  const out: TurnRecord[] = turns.map((t, n) => {
    const id = `turn-${n}`;
    const last = n === turns.length - 1;
    return { id, prompt: t.prompt, status: last ? live(s, t.events) : ended(t.events), createdAt: t.at, events: t.events.map((e, i) => eventOf(id, i, e, t.at)) };
  });
  const waiting = approvals.filter((a) => a.session === s.id && a.state === "pending");
  const current = out[out.length - 1];
  if (current && waiting.length) {
    current.events = [
      ...current.events,
      ...waiting.map((a) => ({ id: `approval-${a.id}`, kind: "tool_use", content: a.input, tool: a.tool, label: a.tool, command: a.input, toolUseId: a.id, approvalStatus: "pending", createdAt: s.last })),
    ];
  }
  return [...out, ...queue.map((prompt, i) => ({ id: `queued-${i}`, prompt, status: "queued", createdAt: s.last, events: [] }))];
}

export const sessions = {
  start: (env: string, prompt: string) => request<Session>("POST", "sessions", { env, prompt }),
  say: (id: string, prompt: string, to?: string) => request("POST", `sessions/${id}/turns`, to ? { prompt, to } : { prompt }),
  stop: (id: string) => request("POST", `sessions/${id}/stop`),
  // A queued message leaves the queue: the plane names it by its place and checks its text.
  unqueue: (id: string, index: number, text: string) => request("DELETE", `sessions/${id}/queue/${index}`, { text }),
  decide: (approval: string, approve: boolean) => request("POST", `approvals/${approval}/${approve ? "approve" : "deny"}`),
  remove: (id: string) => request("DELETE", `sessions/${id}`),
  preview: (host: string) => request<{ url: string }>("POST", "previews", { host }),
  changes: (id: string) => request<Changes>("GET", `sessions/${id}/changes`),
};
