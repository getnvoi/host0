import type { TabStatus } from "../../primitives";
// The values the session screens take, field for field as `packages/core` serves them (`app/resources`,
// `doc/openapi.yaml`), in camelCase. Times are ISO strings as the API sends them. The screens derive what they show.
import type { Tone } from "../../tokens";
import type { ListState } from "../../lists";

// A body that loads: still loading, failed with the API's message and code, or loaded.
export type Load<T> = "loading" | { failed: string; code?: string } | { value: T };

export const load = {
  failed: (failed: string, code?: string): { failed: string; code?: string } => ({ failed, code }),
  value: <T>(value: T): { value: T } => ({ value }),
  // The list page's state; the rows come from the value.
  list: <T>(l: Load<T>): ListState => (l === "loading" ? "loading" : "failed" in l ? { failed: l.failed } : "loaded"),
  get: <T>(l: Load<T> | undefined): T | undefined => (l && l !== "loading" && "value" in l ? l.value : undefined),
};

// `AuthorResource`: who wrote a message or a note, or decided a call.
// `picture`: where their avatar is served, when they chose one.
export type AuthorRecord = { id: string; name: string; picture?: string };

// `worktree.pull_request`: the link once one is open or merged, else the count of changed files. `ship`: an app
// made in h0, whose button asks the agent to ship instead.
export type PullRequestRecord = { url?: string | null; state?: string | null; changed: number; ship?: boolean };

// `WorktreeResource`: the checkout a session runs in. `state` is new, starting, running, paused or failed.
export type WorktreeRecord = {
  id: string;
  repoId: string;
  environmentId: string;
  branch: string;
  state: string;
  hostname?: string | null;
  serving: boolean;
  createdAt: string;
  pullRequest?: PullRequestRecord | null;
};

// `SessionResource`. `status`: running, waiting or idle, what the latest turn is doing.
export type SessionRecord = {
  id: string;
  title: string;
  status: string;
  archived: boolean;
  agentId: string;
  repoId: string;
  environmentId: string;
  worktree: WorktreeRecord;
  createdAt: string;
  updatedAt: string;
  // A session started from a tab: no repository or machine, the tab it acts in.
  tab?: TabStatus;
  // Under `GET /sessions?q=`: the words around the best match in its repository or transcript; none when the
  // title matched or nothing was searched.
  excerpt?: string | null;
  // The members who wrote in it, the requester included.
  people?: AuthorRecord[];
};

// `RepoResource`: a repository (`owner/repo`) with its environments.
export type RepoRecord = {
  id: string;
  name: string;
  owner: string;
  defaultBranch?: string | null;
  environments: { id: string; name: string; providerName: string }[];
};

// The repository without its owner, as `WorktreeSession#project` names it.
export const project = (r: { name: string }) => r.name.split("/").pop() ?? r.name;

// `model`: the model the agent runs (`AgentResource#model`).
export type AgentRecord = { id: string; name: string; slug: string; tagline?: string | null; model?: string | null };

// `TurnResource.event`. `kind`: status, message, thinking, tool_use, tool_result, task, result, error, notice or
// note. `approvalStatus`: pending, approved or rejected on a call that waits on a person. `verdict`: allowed,
// denied, answered, dismissed, or failed for an allowed call that did not go through.
export type EventRecord = {
  id: string;
  kind: string;
  content: string;
  tool?: string | null;
  // A call's name for a person and its one line, as the API serves them (`Event.label`, `Event.command`).
  label?: string | null;
  command?: string | null;
  toolUseId?: string | null;
  parentToolUseId?: string | null;
  approvalStatus?: string | null;
  verdict?: string | null;
  outcome?: string | null;
  decidedBy?: AuthorRecord | null;
  decidedAt?: string | null;
  durationMs?: number | null;
  // A `steer` (a message given while the agent worked): who wrote it, and whether the agent took it. One with a
  // `parentToolUseId` was written to that sub-agent.
  author?: AuthorRecord | null;
  read?: boolean | null;
  createdAt: string;
};

// `TurnResource.files`: a file attached to a message. `url` opens it; `thumbnailState` is ready (with `thumbnailUrl`,
// its first page or picture rendered on a box), pending while it waits on one, failed, or none for a file with no
// picture. Paths are made absolute on the API's host by the app.
export type AttachmentRecord = {
  id: string;
  name: string;
  contentType: string;
  byteSize: number;
  url: string;
  thumbnailState: string;
  thumbnailUrl?: string | null;
};

// `TurnResource.folded`: a message queued behind a running turn that started with the next one, in its own words.
export type FoldedRecord = {
  id: string;
  prompt: string;
  createdAt: string;
  author?: AuthorRecord | null;
  noteId?: string | null;
  files?: AttachmentRecord[];
};

// `TurnResource.captures`: what the agent's browser kept, a `screenshot` or a `recording` (an mp4 with a poster frame).
// `fileUrl` and `posterUrl` are the files' addresses, `thumbnailUrl` a smaller copy, made absolute on the API's host
// by the app; `url` the page it was taken of, or where a recording started.
export type CaptureRecord = {
  id: string;
  kind: string;
  label: string;
  description?: string | null;
  url: string;
  contentType: string;
  byteSize: number;
  fileUrl: string;
  posterUrl?: string | null;
  thumbnailUrl?: string | null;
  createdAt: string;
};

// `TurnResource`: a message and what the agent did with it. `status`: queued, pending, running, succeeded, failed,
// cancelled or awaiting_approval. `internal`: made by h0, no message is drawn. `conversation`: the sub-agent it
// was written to. `folded`: the messages that started with it, read before the agent's work. `requestedBy`: whose
// messages that work answers, once each; empty for a turn h0 made. `files`: what its writer attached. `captures`:
// the pictures and videos its browser kept, in order.
export type TurnRecord = {
  id: string;
  prompt: string;
  status: string;
  // The app's own copy of a message it sent, shown until the API's answer holds the turn: nothing acts on it yet.
  ahead?: boolean;
  createdAt: string;
  internal?: boolean;
  conversation?: string | null;
  author?: AuthorRecord | null;
  noteId?: string | null;
  folded?: FoldedRecord[];
  requestedBy?: AuthorRecord[];
  events: EventRecord[];
  files?: AttachmentRecord[];
  captures?: CaptureRecord[];
  // The artifact versions its agent saved: their cards close the turn.
  artifacts?: TurnArtifactRecord[];
  // `TurnResource#changes`: the files the turn changed in the checkout, written when it ends; `added` and `removed`
  // are null for a binary file.
  changes?: { path: string; added: number | null; removed: number | null }[] | null;
  // `TurnResource#spend`: what the turn's agent used.
  spend?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cents: number | null };
};

// An artifact version a turn saved (`TurnResource#artifact`).
export type TurnArtifactRecord = { id: string; name: string; kind: string; number: number; createdAt: string };

// `NoteResource`: a note for the team with its replies. `turnId`: the turn it was sent to the agent as.
export type NoteRecord = {
  id: string;
  parentId?: string | null;
  author: AuthorRecord;
  text: string;
  mentions?: AuthorRecord[];
  turnId?: string | null;
  createdAt: string;
  replies?: NoteRecord[];
};

// `GET sessions/{id}/changes`: the patch, when it was taken (nil until the first turn ends) and its base.
export type ChangesRecord = { patch: string; patchAt?: string | null; baseRef?: string | null };

export type LogLine = { step: string; output?: string | null; createdAt: string };

// `GET sessions/{id}/logs`: the last deployment's lines, and the seed machine's while it is built.
export type LogsRecord = { logs: LogLine[]; seed?: { state: string; built: boolean } | null; seedLogs?: LogLine[] };

// `GET sessions/{id}/files`: the checkout's paths and what the branch changed.
export type FilesRecord = { paths: string[]; total: number; cut?: boolean; changed?: { path: string; status?: string | null }[] };

// `GET sessions/{id}/file`: one file's text, or why it is not shown.
export type FileRecord = { path: string; size?: number | null; text?: string | null; refused?: string | null; message?: string | null };

// One process of `GET sessions/{id}/machine`. `role` names what h0 depends on (turn, preview, artifact, terminal,
// proxy, sshd, init); `turn` is the agent's turn a process runs; `killable` says whether a member may stop it. Bytes for
// `rss`, percents for `cpu` and `memory`.
export type ProcessRecord = {
  pid: number;
  parent: number;
  user: string;
  name: string;
  command: string;
  cpu: number;
  rss: number;
  memory: number;
  started: string;
  state: string;
  role?: string | null;
  turn?: string | null;
  killable: boolean;
  // It has a log to read (`GET sessions/{id}/machine/processes/{pid}/output`): h0 started it.
  logs?: boolean;
};

// `GET sessions/{id}/machine/processes/{pid}/output`: the last lines a process wrote, from its unit's journal or its
// log file. `source` is null, with no lines, for a process h0 did not start.
// `follow`: how to stream it live, a socket of the terminal server (`socket + id`, `token` and `follow=<source>` in the
// query) that sends its last lines, then each line as it is written.
export type OutputRecord = {
  pid: number;
  name: string;
  command: string;
  source?: string | null;
  lines: string[];
  follow?: { source: string; socket: string; token: string } | null;
};

// `GET sessions/{id}/machine` (MachineResource): bytes for memory and disk, the load over 1, 5 and 15 minutes, uptime
// in seconds, and the processes by memory.
export type MachineRecord = {
  memory: { total: number; used: number; available: number; swapTotal: number; swapUsed: number };
  cpu: { load: number[]; cores: number };
  disk: { mount?: string | null; total: number; used: number; available: number };
  uptime: number;
  readAt: string;
  processes: ProcessRecord[];
};

// `POST sessions/{id}/machine/kill`: the signal sent and what the process did, stopped, still running or already gone.
export type StopRecord = { pid: number; signal: string; command: string; result: string; turn?: string | null };

// `POST sessions/{id}/terminal`: running, starting, or refused with the reason.
export type TerminalRecord = { state: string; message?: string | null };

// A session with what its page reads beside it: its agent and repository, its turns and notes.
export type SessionDetail = {
  session: SessionRecord;
  agent: AgentRecord;
  repo: RepoRecord;
  turns: TurnRecord[];
  notes: NoteRecord[];
};

export const sessionDetail = {
  environment: (d: SessionDetail) => d.repo.environments.find((e) => e.id === d.session.environmentId),
};

const time = (t: string | Date) => (typeof t === "string" ? new Date(t) : t);
const pad = (n: number) => String(n).padStart(2, "0");

// How the web app says times and states (`WorktreeSession.day`, `.age`, `TurnsHelper#hm`, `RunsHelper#run_took`,
// `WorktreeSessionsHelper::CHECKOUT_STATES`).
export const words = {
  plural: (n: number, one: string, many?: string) => (n === 1 ? `1 ${one}` : `${n} ${many ?? one + "s"}`),

  day(at: string | Date, now: Date) {
    const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((start(now) - start(time(at))) / 86_400_000);
    if (days <= 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days <= 13) return `${days} days ago`;
    if (days <= 27) return `${Math.floor(days / 7)} weeks ago`;
    if (days <= 364) return `${words.plural(Math.max(Math.floor(days / 30), 1), "month")} ago`;
    return `${words.plural(Math.floor(days / 365), "year")} ago`;
  },

  // A time ahead of `now` (the server's clock leads) reads as now.
  age(at: string | Date, now: Date) {
    const s = Math.max(0, (now.getTime() - time(at).getTime()) / 1000);
    if (s < 60) return "now";
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86_400) return `${Math.floor(s / 3600)}h`;
    if (s < 14 * 86_400) return `${Math.floor(s / 86_400)}d`;
    if (s < 60 * 86_400) return `${Math.floor(s / (7 * 86_400))}w`;
    return `${Math.floor(s / (30 * 86_400))}mo`;
  },

  hm(at: string | Date) {
    const d = time(at);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  // A count of tokens: "820 tokens", "7.2k tokens".
  tokens(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k tokens` : `${n} tokens`;
  },

  // Under a twentieth of a second, nothing.
  took(seconds: number): string | undefined {
    if (seconds < 0.05) return undefined;
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${pad(Math.floor(seconds) % 60)}s`;
    return `${Math.floor(seconds / 3600)}h ${pad(Math.floor((seconds % 3600) / 60))}m`;
  },

  // The working line's clock, as `ds/working` counts it.
  clock(seconds: number) {
    const s = Math.max(0, Math.floor(seconds));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${pad(s % 60)}s`;
    return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`;
  },

  // A file's size as `number_to_human_size` says it: "820 Bytes", "14 KB", "1.2 MB".
  bytes(n: number) {
    if (n < 1024) return `${n} Bytes`;
    const units = ["KB", "MB", "GB"];
    let v = n / 1024;
    let u = 0;
    while (v >= 1024 && u < units.length - 1) {
      v /= 1024;
      u++;
    }
    return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[u]}`;
  },

  between: (from: string | Date, to: string | Date) => (time(to).getTime() - time(from).getTime()) / 1000,

  // A checkout's machine as a word and a tone.
  machine(state: string): { word: string; tone: Tone } {
    const known: Record<string, [string, Tone]> = {
      new: ["Not started", "grey"],
      starting: ["Starting", "orange"],
      running: ["Running", "green"],
      paused: ["Paused", "grey"],
      failed: ["Setup failed", "red"],
    };
    const [word, tone] = known[state] ?? [state.charAt(0).toUpperCase() + state.slice(1), "grey"];
    return { word, tone };
  },

  initials(name: string) {
    const parts = name.split(" ").filter(Boolean).slice(0, 2);
    const letters = parts.length > 1 ? parts.map((p) => p[0]) : [...name.slice(0, 2)];
    return letters.join("").toUpperCase();
  },

  // "10 minutes ago", as RelativeDateTimeFormatter says it.
  relative(at: string | Date, now: Date) {
    const s = (time(at).getTime() - now.getTime()) / 1000;
    const f = new Intl.RelativeTimeFormat("en", { numeric: "always" });
    const a = Math.abs(s);
    if (a < 60) return f.format(Math.round(s), "second");
    if (a < 3600) return f.format(Math.round(s / 60), "minute");
    if (a < 86_400) return f.format(Math.round(s / 3600), "hour");
    if (a < 30 * 86_400) return f.format(Math.round(s / 86_400), "day");
    return f.format(Math.round(s / (30 * 86_400)), "month");
  },
};
