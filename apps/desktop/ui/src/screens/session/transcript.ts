// How the conversation reads a session's turns and notes, as packages/core's web UI does it
// (worktree_sessions/_timeline, _turn, _work, _segment; Turn.parts, RunsHelper, GatesHelper, TurnsHelper).
import { nameList, Tool, type ActDetail, type ActOutcome, type ActRowProps, type ActState, type DiffLine, type GateQuestion, type NoteReply, type SubagentRun } from "../../conversation";
import type { CaptureView, FileView } from "../../media";
import type { Tone } from "../../tokens";
import { artifactModel, type ArtifactModel, type Part } from "../models";
import { words, type AttachmentRecord, type CaptureRecord, type EventRecord, type NoteRecord, type SessionDetail, type TurnRecord } from "./records";

// One step the agent took, as its row shows it.
// `detail`: what the row shows once opened.
export type RunRow = { face: string; label: string; mono: boolean; target: string; outcome: ActOutcome; state: ActState; detail?: ActDetail };

export const runRow = (r: RunRow): ActRowProps => ({ face: r.face, label: r.label, mono: r.mono, target: r.target, outcome: r.outcome, state: r.state, detail: r.detail });

// What the transcript draws, in order.
export type TranscriptItem =
  // `queued`: waiting in line on a machine that is up; `cancel`: the turn can still be withdrawn; `from`: the note it
  // was made from; `files`: what was attached.
  | { kind: "message"; author: string; initials?: string; picture?: string; time: string; text: string; queued: boolean; cancel: boolean; turnId?: string; from?: string; to?: string; files?: FileView[] }
  // `for`: the people whose messages the agent's turn answers.
  | { kind: "agent"; name: string; time: string; for?: string[] }
  | { kind: "prose"; text: string }
  | { kind: "run"; summary: string; time: string; rows: RunRow[] }
  // The sub-agents a turn started, or the workflow steps it handed on (`steps`).
  | { kind: "agents"; title: string; runs: SubagentRun[]; steps: boolean }
  | { kind: "error"; title: string; text: string }
  // A finished turn's closing line: how long it took, its tool calls, the files it changed (`files` null when the API
  // has none for it).
  | { kind: "tally"; time: string; tools: number; files: { count: number; added: number; removed: number } | null }
  | { kind: "note"; id: string; author: string; initials: string; picture?: string; time: string; text: string; replies: NoteReply[]; sent: boolean }
  | { kind: "notice"; title?: string; text: string; tone: Tone; action?: string }
  | { kind: "artifact"; artifact: ArtifactModel }
  // The pull request a run opened, closing it: its title, the branch, the start of its body and where it is.
  | { kind: "pullRequest"; title: string; branch: string; excerpt?: string; url: string }
  // Screenshots and recordings the agent's browser kept, placed among the work by when they were made. `turnId`: the
  // turn they belong to, whose captures the lightbox walks.
  | { kind: "captures"; captures: CaptureView[]; turnId?: string }
  // Who is at work, as the working line says it.
  | { kind: "working"; text: string };

// A call waiting on a person, for the composer's gate. `asked`: whose turn asked it.
export type PendingCall = { toolUseId: string; question: boolean; title: string; detail: string; questions: GateQuestion[]; asked?: string };

const cut = (text: string, max: number) => (text.length > max ? text.slice(0, max - 1) + "…" : text);
const by = (a: { createdAt: string }, b: { createdAt: string }) => Date.parse(a.createdAt) - Date.parse(b.createdAt);

function json(content: string): Record<string, unknown> {
  try {
    const value = JSON.parse(content);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

const text = (v: unknown) => (typeof v === "string" ? v : undefined);

export const Tools = {
  // `Turn::TOOL_PREFIX`: nvoi's own tools as the agent names them.
  prefix: "mcp__nvoi__",
  // `Provision::Phases::PREFIX`: the machine's setup, drawn as calls.
  phase: "provision__",

  name: (tool?: string | null) => (tool ?? "").replaceAll("mcp__nvoi__", ""),

  // `RunsHelper::FACES` and `PHASE_FACES`.
  face(tool?: string | null): string {
    const t = tool ?? "";
    if (t.startsWith(Tools.phase)) {
      const phases: Record<string, string> = { box: "env", seed: "env", tools: "tool", checkout: "repo", database: "env", setup: "terminal", app: "preview" };
      return phases[t.slice(Tools.phase.length)] ?? "env";
    }
    const faces: Record<string, string> = {
      Bash: "bash", BashOutput: "bash", KillShell: "bash", Read: "read", Edit: "edit", MultiEdit: "edit", Write: "edit", NotebookEdit: "edit",
      Glob: "grep", Grep: "grep", LS: "grep", Task: "subagent", Agent: "subagent", SendMessage: "subagent", Skill: "skill", TodoWrite: "plan",
      EnterPlanMode: "plan", ExitPlanMode: "plan", set_title: "settitle", ask_user: "you", create_screenshot: "screenshot", push_branch: "push",
      create_pull_request: "pr", start_step: "plan", complete_step: "plan", search_sessions: "grep", search_artifacts: "grep", search_library: "grep",
      fetch_page: "globe", browse: "click", record_video: "screenshot", save_page: "artifact",
      list_processes: "server", stop_process: "server",
      look: "read", find: "grep", click: "click", hover: "click", type: "type", fill: "type", press: "press", scroll: "scroll", open: "globe", back: "back", forward: "globe", reload: "globe", wait: "wait", screenshot: "screenshot", evaluate: "terminal",
    };
    return faces[Tools.name(t)] ?? "tool";
  },

  // What a person calls the call, as the API names it (`Event.label`).
  label: (e: EventRecord): string => e.label ?? Tools.name(e.tool),

  input: (e: EventRecord) => json(e.content),

  // The call as one line, as the API serves it (`Event.command`).
  command: (e: EventRecord): string => e.command ?? "",

  // `GatesHelper#gate_action`: a gated call exactly as it runs, a push as its git command.
  action(e: EventRecord, branch: string): string {
    const n = Tools.name(e.tool);
    if (n === "ask_user") return Tools.questions(e).map((q) => q.question).join("\n");
    if (n === "complete_step") return text(Tools.input(e).summary) ?? "";
    if (n === "push_branch") return `git push origin ${branch}`;
    return Tools.command(e);
  },

  // An opened row (`RunsHelper#run_output`): the call in full when it reads as code, the arguments its row leaves out
  // (none for Bash and TodoWrite), an edit's change as a diff in place of its old and new text, then the output.
  detail(call: EventRecord, target: string, mono: boolean, output?: string): ActDetail | undefined {
    const input = Tools.input(call);
    const n = Tools.name(call.tool);
    // The argument its row already shows is left out.
    const rest = Object.fromEntries(Object.entries(input).filter(([, v]) => String(v) !== target));
    let diffs: ActDetail["diffs"];
    const file = text(input.file_path) ?? "";
    const lines = (before: string, after: string): DiffLine[] => [
      ...(before ? before.split("\n").map((t) => ({ text: t, kind: "removed" as const })) : []),
      ...(after ? after.split("\n").map((t) => ({ text: t, kind: "added" as const })) : []),
    ];
    if (n === "Edit" && typeof input.old_string === "string" && typeof input.new_string === "string") {
      diffs = [{ file, lines: lines(input.old_string, input.new_string) }];
      delete rest.old_string;
      delete rest.new_string;
      // Replacing the one occurrence is what an edit does; only the other case is worth saying.
      if (rest.replace_all === false) delete rest.replace_all;
    } else if (n === "MultiEdit" && Array.isArray(input.edits)) {
      diffs = input.edits.flatMap((e: Record<string, unknown>) =>
        typeof e?.old_string === "string" && typeof e?.new_string === "string" ? [{ file, lines: lines(e.old_string, e.new_string) }] : [],
      );
      delete rest.edits;
    } else if (n === "Write" && typeof input.content === "string") {
      diffs = [{ file, lines: lines("", input.content) }];
      delete rest.content;
    }
    // An argument the row's line already says (its `key: value`, or the field that is the call) is left out; the others
    // are `key value` pairs, a structured value as JSON.
    const shown = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v, null, typeof v === "object" && JSON.stringify(v).length > 80 ? 2 : undefined));
    const args = ["Bash", "TodoWrite", "ask_user"].includes(n)
      ? undefined
      : Object.entries(rest)
          .filter(([k, v]) => v !== null && v !== undefined && v !== "" && !target.includes(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`))
          .map(([key, v]) => ({ key, value: shown(v) as string }));
    // The diff's head names the file; any other call reading as code shows it whole.
    const command = mono && !diffs?.length && target ? target : undefined;
    const detail: ActDetail = { command, args: args?.length ? args : undefined, diffs: diffs?.length ? diffs : undefined, output };
    return detail.command || detail.args || detail.diffs || detail.output ? detail : undefined;
  },

  // `Tools::AskUser.questions`: each question's text, header, whether several can be picked, and its options.
  questions(e: EventRecord): GateQuestion[] {
    const list = Tools.input(e).questions;
    if (Tools.name(e.tool) !== "ask_user" || !Array.isArray(list)) return [];
    return list.flatMap((q: Record<string, unknown>) => {
      const question = text(q?.question);
      if (!question) return [];
      const options = (Array.isArray(q.options) ? q.options : []).flatMap((o: Record<string, unknown>) =>
        text(o?.label) ? [{ title: o.label as string, detail: text(o.description) ?? "" }] : [],
      );
      return [{ question, header: text(q.header) || undefined, multiple: q.multiSelect === true, options }];
    });
  },

  // `GatesHelper#gate_excerpt`: a question's first question and how many follow, any other call its label.
  excerpt(e: EventRecord) {
    const qs = Tools.questions(e);
    if (!qs.length) return Tools.label(e);
    const first = cut(qs[0].question, 110);
    return qs.length > 1 ? `${first} (+${qs.length - 1})` : first;
  },

  // `Event#verdict`: an allowed call that did not go through says Failed, never Denied.
  verdict(e: EventRecord): [string, Tone] {
    if (e.verdict === "failed") return ["Failed", "red"];
    const approved = e.approvalStatus === "approved";
    if (Tools.name(e.tool) === "ask_user") return approved ? ["Answered", "green"] : ["Dismissed", "grey"];
    return approved ? ["Allowed", "green"] : ["Denied", "red"];
  },

  // `RunsHelper::KINDS` and `PHRASES`: "Read 4 files, ran 3 commands", when three kinds or fewer say it.
  summary(calls: EventRecord[]): string | undefined {
    const kinds: Record<string, string> = {
      Read: "read", Edit: "edit", MultiEdit: "edit", Write: "edit", NotebookEdit: "edit", Bash: "bash", Grep: "search", Glob: "search", LS: "search",
      WebFetch: "web", WebSearch: "web", TodoWrite: "plan",
    };
    const phrases: Record<string, [string, string]> = {
      read: ["read a file", "read %d files"], edit: ["edited a file", "edited %d files"], bash: ["ran a command", "ran %d commands"],
      search: ["ran a search", "ran %d searches"], web: ["looked up a page", "looked up %d pages"], plan: ["updated the plan", "updated the plan %d times"],
      other: ["one other action", "%d other actions"],
    };
    const order: string[] = [];
    const counts: Record<string, number> = {};
    for (const call of calls) {
      const kind = kinds[call.tool ?? ""] ?? "other";
      if (counts[kind] === undefined) order.push(kind);
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    if (order.length > 3 || (order.length === 1 && order[0] === "other")) return undefined;
    const said = order.map((k) => (counts[k] === 1 ? phrases[k][0] : phrases[k][1].replace("%d", String(counts[k])))).join(", ");
    return said.charAt(0).toUpperCase() + said.slice(1);
  },
};

const results = (events: EventRecord[]) => {
  const out = new Map<string, EventRecord>();
  for (const e of events) if (e.kind === "tool_result" && e.toolUseId && !out.has(e.toolUseId)) out.set(e.toolUseId, e);
  return out;
};

const tasks = (events: EventRecord[], ids: string[]) =>
  events
    .filter((e) => e.kind === "task" && e.toolUseId && ids.includes(e.toolUseId))
    .sort(by)
    .map((e) => json(e.content));

// What the server writes on a turn whose message to a sub-agent the agent did not pass on (`Nvoi.Subagent.unrelayed/3`).
const unrelayedNotice = "Your message to ";

// Each sub-agent's agentId by the tool_use_id of the call that started it, read from that call's result.
function subagentIds(detail: SessionDetail): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of detail.turns.flatMap((t) => t.events)) {
    const id = e.kind === "tool_result" && e.toolUseId ? e.content.match(/agentId: (\w+)/)?.[1] : undefined;
    if (id) out.set(e.toolUseId!, id);
  }
  return out;
}

// The SendMessage calls (and their results) a turn made to relay a person's message to a sub-agent, to its agentId.
function relayed(turn: TurnRecord, agentIds: Map<string, string>): Set<string> {
  const out = new Set<string>();
  // The turn's own message to a sub-agent (`conversation`), from its start; each steer naming one, from that steer.
  const asked = [
    ...(turn.conversation ? [{ to: turn.conversation, from: turn.createdAt }] : []),
    ...turn.events.filter((e) => e.kind === "steer" && e.parentToolUseId).map((e) => ({ to: e.parentToolUseId!, from: e.createdAt })),
  ];
  for (const ask of asked) {
    const agentId = agentIds.get(ask.to);
    if (!agentId) continue;
    for (const e of turn.events)
      if (e.kind === "tool_use" && e.tool === "SendMessage" && e.createdAt >= ask.from && String(Tools.input(e).to ?? "") === agentId) {
        out.add(e.id);
        for (const r of turn.events) if (r.kind === "tool_result" && r.toolUseId === e.toolUseId) out.add(r.id);
      }
  }
  return out;
}

export const Transcript = {
  // Turns and notes in the order they happened, each a group: what follows a group's head aligns with the
  // speaker's name.
  groups(detail: SessionDetail): TranscriptItem[][] {
    const agent = detail.agent.name;
    const agentIds = subagentIds(detail);
    const tree = detail.session.worktree;
    const running = tree.state === "running";
    // A note written while a turn works stays where it was written, among the agent's work: it goes inside that turn,
    // and the turn's later work comes after it.
    const turns = [...detail.turns].sort(by);
    const roots = detail.notes.filter((n) => !n.parentId);
    const within = new Map<string, NoteRecord[]>();
    for (const [i, t] of turns.entries()) {
      const next = turns[i + 1] ? Date.parse(turns[i + 1].createdAt) : Infinity;
      const working = ["running", "pending", "awaiting_approval"].includes(t.status);
      const end = Math.max(...t.events.map((e) => Date.parse(e.createdAt)));
      const at = (n: NoteRecord) => Date.parse(n.createdAt);
      const mine = roots.filter((n) => at(n) > Date.parse(t.createdAt) && at(n) < next && (working || at(n) <= end));
      if (mine.length) within.set(t.id, mine);
    }
    const inside = new Set([...within.values()].flat());
    const moments = [
      // A turn that carried a person's message to a sub-agent shows here too: what the agent did besides the relay.
      ...turns.map((turn) => ({ turn, createdAt: turn.createdAt })),
      ...roots.filter((n) => !inside.has(n)).map((note) => ({ note, createdAt: note.createdAt })),
    ].sort(by);
    const out: TranscriptItem[][] = [];
    for (const m of moments) {
      if ("note" in m) out.push([Transcript.note(m.note)]);
      else out.push(...Transcript.turn(m.turn, agent, tree.branch, running, detail.notes, Transcript.resumed(detail, m.turn), agentIds, within.get(m.turn.id)));
    }
    return out;
  },

  note(note: NoteRecord): TranscriptItem {
    const replies = [...(note.replies ?? [])].sort(by).map((r) => ({ author: r.author.name, initials: words.initials(r.author.name), time: words.hm(r.createdAt), text: r.text }));
    return { kind: "note", id: note.id, author: note.author.name, initials: words.initials(note.author.name), picture: note.author.picture, time: words.hm(note.createdAt), text: note.text, replies, sent: !!note.turnId };
  },

  // `agentIds`: the session's sub-agents (`subagentIds`), so the relays of a person's messages to them stay out of here.
  // `inline`: the notes written while it worked, placed among its work by time.
  turn(turn: TurnRecord, agent: string, branch: string, running: boolean, notes: NoteRecord[] = [], resumed = false, agentIds = new Map<string, string>(), inline: NoteRecord[] = []): TranscriptItem[][] {
    const out: TranscriptItem[][] = [];
    // `TurnsHelper#turn_author`: whose note the message was made from.
    const from = (noteId?: string | null) => {
      const note = noteId ? notes.find((n) => n.id === noteId) : undefined;
      return note ? `From ${note.author.name}'s note` : undefined;
    };
    // A message to a sub-agent is drawn in its conversation, not here.
    if (!turn.internal && !turn.conversation) {
      const name = turn.author?.name ?? "You";
      // Queued behind a turn on a box that is up; waiting on the box is what the working line says.
      out.push([
        {
          kind: "message", author: name, initials: words.initials(name), picture: turn.author?.picture, time: words.hm(turn.createdAt), text: turn.prompt,
          queued: turn.status === "queued" && running, cancel: turn.status === "queued" && !turn.ahead, turnId: turn.id, from: from(turn.noteId),
          files: (turn.files ?? []).map(Transcript.file),
        },
      ]);
    }
    // The messages that started with it, each in its writer's name, before the agent's work.
    for (const f of [...(turn.folded ?? [])].sort(by)) {
      const name = f.author?.name ?? "You";
      out.push([{ kind: "message", author: name, initials: words.initials(name), time: words.hm(f.createdAt), text: f.prompt, queued: false, cancel: false, turnId: f.id, from: from(f.noteId), files: (f.files ?? []).map(Transcript.file) }]);
    }
    // A person's message to a sub-agent goes through the agent, which relays it with SendMessage: the message, the
    // relay and a notice that it was not passed on belong to the sub-agent's conversation, not this one.
    const relays = relayed(turn, agentIds);
    // A turn that carried a message to a sub-agent keeps here only the agent's real work besides the relay (its edits,
    // its commands): its words are about the relay, and the sub-agent answers in its own conversation.
    const events = turn.events
      .filter((e) => !e.parentToolUseId && !relays.has(e.id) && !(e.kind === "notice" && e.content.startsWith(unrelayedNotice)))
      .filter((e) => !turn.conversation || (e.kind !== "message" && e.kind !== "prose"))
      .sort(by);
    const live = ["running", "pending", "queued"].includes(turn.status);
    const kept = (turn.captures ?? []).filter((c) => c.kind === "screenshot" || c.kind === "recording").sort(by);
    const box = Transcript.work(events, turn.events, results(events), live, turn.status === "queued", branch, kept, turn.id, resumed, inline);
    if (box.length) {
      const first = events.find((e) => e.kind !== "status")?.createdAt ?? turn.createdAt;
      const meta = [words.hm(first), turn.status === "cancelled" ? "Stopped" : undefined].filter(Boolean).join(" · ");
      box.unshift({ kind: "agent", name: agent, time: meta, for: Transcript.requesters(turn) });
    } else if (turn.status === "cancelled") {
      // "Before it started" only when the turn recorded nothing; any event means the agent worked.
      box.push({ kind: "notice", text: turn.events.length ? "Stopped" : `Stopped before ${agent} started`, tone: "grey" });
    }

    for (const notice of events) if (notice.kind === "notice") box.push({ kind: "notice", text: notice.content, tone: "blue" });
    if (turn.status === "failed") {
      const f = Transcript.failure(turn.events, agent);
      box.push({ kind: "notice", title: f.title, text: f.text, tone: "red", action: f.action });
    }
    // The artifacts it saved close the turn, the newest version of each once.
    const saved = new Map((turn.artifacts ?? []).map((a) => [a.id, a]));
    for (const a of saved.values()) box.push({ kind: "artifact", artifact: artifactModel.saved(a, agent) });
    const opened = live ? undefined : Transcript.opened(events, branch);
    if (opened) box.push(opened);
    // A finished turn that used tools closes on what it did: its time, its calls, what it changed.
    const worked = events.filter((e) => e.kind !== "status");
    if (!live && worked.some((e) => e.kind === "tool_use")) {
      const changes = turn.changes;
      box.push({
        kind: "tally",
        time: words.took(words.between(worked[0].createdAt, worked[worked.length - 1].createdAt)) ?? "",
        tools: worked.filter((e) => e.kind === "tool_use").length,
        files: changes ? { count: changes.length, added: changes.reduce((n, c) => n + (c.added ?? 0), 0), removed: changes.reduce((n, c) => n + (c.removed ?? 0), 0) } : null,
      });
    }
    // A note or a message given mid-turn stands on its own between the parts before and after it; the agent's head stays
    // on the first part of its work, and comes again after a message, over what the agent did with it.
    let part: TranscriptItem[] = [];
    const head = (p: TranscriptItem[]) => p.length === 1 && p[0].kind === "agent";
    for (const item of box) {
      if (item.kind !== "note" && item.kind !== "message") {
        part.push(item);
        continue;
      }
      if (part.length && !head(part)) {
        out.push(part);
        part = [];
      }
      out.push([item]);
      if (item.kind === "message") part = [{ kind: "agent", name: agent, time: item.time }];
    }
    // A head after a message with nothing under it yet waits for the agent's work.
    if (part.length && !(head(part) && box.some((i) => i.kind === "message"))) out.push(part);
    return out;
  },

  // The pull request an allowed `create_pull_request` opened, read from its outcome or its result; none while it waits
  // for approval or when the call reports no link (a shipped app is merged, not opened).
  opened(events: EventRecord[], branch: string): TranscriptItem | undefined {
    const found = results(events);
    const call = [...events].reverse().find((e) => e.kind === "tool_use" && Tools.name(e.tool) === "create_pull_request" && e.approvalStatus === "approved");
    if (!call) return undefined;
    const url = (call.outcome ?? (call.toolUseId ? found.get(call.toolUseId)?.content : undefined) ?? "").match(/https?:\/\/\S+/)?.[0];
    if (!url) return undefined;
    const input = Tools.input(call);
    const first = text(input.body)?.split("\n").map((l) => l.replace(/^[#>*\-\s]+/, "").trim()).find(Boolean);
    return { kind: "pullRequest", title: text(input.title) ?? branch, branch, excerpt: first ? cut(first, 160) : undefined, url };
  },

  // `worktree_sessions/_work`: what a signed box holds, from its events in order. `all` is where the `task` lines
  // reporting on sub-agents are read.
  // `captures` are placed by time: each before the first part that started after it was made, the rest at the end.
  work(
    events: EventRecord[], all: EventRecord[], found: Map<string, EventRecord>, live: boolean, setup: boolean, branch: string,
    captures: CaptureRecord[] = [], turnId?: string, resumed = false, notes: NoteRecord[] = [],
  ): TranscriptItem[] {
    const box: TranscriptItem[] = [];
    let next = 0;
    let noted = 0;
    const written = [...notes].sort(by);
    const place = (before?: string) => {
      const due: CaptureRecord[] = [];
      while (next < captures.length && (before === undefined || Date.parse(captures[next].createdAt) <= Date.parse(before))) due.push(captures[next++]);
      if (due.length) box.push({ kind: "captures", captures: due.map(Transcript.capture), turnId });
      while (noted < written.length && (before === undefined || Date.parse(written[noted].createdAt) <= Date.parse(before))) box.push(Transcript.note(written[noted++]));
    };
    // The machine's setup and the agent's calls after it are one run of actions until the agent says something.
    const parts = Transcript.parts(events).reduce<[string, EventRecord[]][]>((out, [p, run]) => {
      const part = ["phases", "gate"].includes(p) ? "tools" : p;
      const last = out[out.length - 1];
      if (last && last[0] === part && part === "tools") last[1].push(...run);
      else out.push([part, [...run]]);
      return out;
    }, []).flatMap(([part, run]): [string, EventRecord[]][] => {
      // A note written in the middle of a run of actions cuts it there, so the note keeps its place in time.
      if (part !== "tools") return [[part, run]];
      const cuts: [string, EventRecord[]][] = [[part, []]];
      for (const e of run) {
        const current = cuts[cuts.length - 1][1];
        const prev = current[current.length - 1];
        if (prev && written.some((n) => Date.parse(n.createdAt) > Date.parse(prev.createdAt) && Date.parse(n.createdAt) <= Date.parse(e.createdAt))) cuts.push([part, [e]]);
        else current.push(e);
      }
      return cuts;
    });
    for (const [index, [part, run]] of parts.entries()) {
      place(run[0].createdAt);
      if (part === "message") box.push(...run.map((e) => ({ kind: "prose" as const, text: e.content })));
      else if (part === "subagents") box.push({ kind: "agents", title: "Sub-agents", runs: Transcript.subagents(run, all, found, live), steps: false });
      else if (part === "steps") box.push({ kind: "agents", title: "Steps", runs: Transcript.steps(run, found, live), steps: true });
      else if (part === "tools") {
        const rows = run.map((e) => (e.approvalStatus ? Transcript.decided(e, branch) : Transcript.row(e, found, live, branch)));
        const isPhase = (e: EventRecord) => (e.tool ?? "").startsWith(Tools.phase);
        const phases = run.filter(isPhase);
        const calls = run.filter((e) => !isPhase(e));
        // Folded always: while the agent works, the line says its last action; once it speaks, what the run did.
        const said = parts.slice(index + 1).some(([p]) => p === "message");
        const last = rows[rows.length - 1];
        const doing = isPhase(run[run.length - 1]) ? last.target : [last.label, last.target].filter(Boolean).join(" ");
        const did = [
          phases.length ? Transcript.setupSummary(phases, rows.filter((_, i) => isPhase(run[i])), setup, resumed) : undefined,
          calls.length ? Tools.summary(calls) ?? words.plural(calls.length, "action") : undefined,
        ].filter(Boolean).map((s, i) => (i === 0 ? s! : s!.charAt(0).toLowerCase() + s!.slice(1))).join(", ");
        box.push({ kind: "run", summary: !said && doing ? doing : did, time: Transcript.took(run, found) ?? "", rows });
      } else if (part === "steer") {
        // A message given while the agent worked ("Send now", or sent to a running turn): it reads as the person's
        // message, where the agent took it.
        for (const e of run) {
          const name = e.author?.name ?? "You";
          box.push({ kind: "message", author: name, initials: words.initials(name), picture: e.author?.picture, time: words.hm(e.createdAt), text: e.content, queued: false, cancel: false });
        }
      } else if (part === "error") {
        // `RunsHelper#error_title`; the message stays folded, the notice below says the cause and the fix.
        for (const e of run) box.push({ kind: "error", title: e.content.startsWith("The machine could not be started") ? "Setup failed" : "Turn failed", text: e.content });
      }
    }
    place();
    return box;
  },

  // A decided gate's row: its verdict, who decided and when.
  decided(call: EventRecord, branch: string): RunRow {
    const [word, tone] = Tools.verdict(call);
    const who = [call.decidedBy?.name, call.decidedAt ? words.hm(call.decidedAt) : undefined].filter(Boolean).join(" · ");
    return { face: Tools.face(call.tool), label: Tools.label(call), mono: Tools.name(call.tool) === "push_branch", target: Tools.questions(call).length ? Tools.excerpt(call) : Tools.action(call, branch), outcome: { kind: "decision", word, tone, by: who || undefined }, state: "done" };
  },

  capture: (c: CaptureRecord): CaptureView => ({
    id: c.id, kind: c.kind === "recording" ? "recording" : "screenshot", label: c.label, url: c.url, src: c.fileUrl,
    thumb: c.thumbnailUrl ?? undefined, poster: c.posterUrl ?? undefined, description: c.description ?? undefined,
  }),

  file: (f: AttachmentRecord): FileView => ({
    id: f.id, name: f.name, size: words.bytes(f.byteSize), contentType: f.contentType, src: f.url, thumb: f.thumbnailUrl ?? undefined,
    state: f.thumbnailState === "ready" || f.thumbnailState === "pending" || f.thumbnailState === "failed" ? f.thumbnailState : "none",
  }),

  // `worktree_sessions/_thread` (`Subagent#runs`): a sub-agent's conversation by its call's `tool_use_id`. What the
  // agent asked it, then each stretch: the message written to it, what that made it do and what it answered.
  thread(detail: SessionDetail, id: string): { name: string; groups: TranscriptItem[][] } | undefined {
    const all = detail.turns.flatMap((t) => t.events).sort(by);
    const call = all.find((e) => e.kind === "tool_use" && e.toolUseId === id);
    if (!call) return undefined;
    const input = Tools.input(call);
    const name = [text(input.description), text(input.subagent_type)].find((s) => s) ?? "sub-agent";
    const result = all.find((e) => e.kind === "tool_result" && e.toolUseId === id);
    const agentId = result?.content.match(/agentId: (\w+)/)?.[1];
    // The call that started it, then each SendMessage that continued it.
    const sends = all.filter((e) => e.kind === "tool_use" && e.tool === "SendMessage" && agentId !== undefined && String(Tools.input(e).to ?? "") === agentId);
    const ids = [id, ...sends.flatMap((s) => (s.toolUseId ? [s.toolUseId] : []))];
    // A person's message given while the agent worked (`steer`) is the person's, not the sub-agent's work.
    const mine = all.filter((e) => e.parentToolUseId && ids.includes(e.parentToolUseId) && e.kind !== "steer");
    const found = results(mine);
    const reports = tasks(all, ids);
    const answers = reports.flatMap((t) => (text(t.summary) ? [t.summary as string] : []));
    const last = reports[reports.length - 1] ?? {};
    const owner = detail.turns.find((t) => t.events.some((e) => e.id === call.id));
    const moved = reports.length === 0 ? owner : [...detail.turns].reverse().find((t) => t.events.some((e) => e.kind === "task" && e.toolUseId && ids.includes(e.toolUseId)));
    let state: SubagentRun["state"];
    if (last.state === "notification") state = last.status === "completed" ? "done" : "failed";
    else state = moved && ["running", "pending"].includes(moved.status) ? "running" : "done";

    const agent = detail.agent.name;
    const branch = detail.session.worktree.branch;
    const prompt = text(input.prompt) ?? "";
    const out: TranscriptItem[][] = [[{ kind: "agent", name: `${agent} → ${name}`, time: words.hm(call.createdAt) }, ...(prompt ? [{ kind: "prose" as const, text: prompt }] : [])]];
    // What people wrote to it: a message of its own (a turn whose `conversation` it is) or one given while the agent
    // worked (a `steer` naming it). Each is followed by what the agent's SendMessage calls after it made it do.
    const turnOf = (e: EventRecord) => detail.turns.find((t) => t.events.some((x) => x.id === e.id));
    // Every message here went to the sub-agent through the agent, which passes it on.
    const sentTo = `Sent to ${name}, through ${agent}`;
    const steers = all.filter((e) => e.kind === "steer" && e.parentToolUseId === id);
    const messages: { item: Extract<TranscriptItem, { kind: "message" }>; sent: (send: EventRecord) => boolean; at: string }[] = [
      ...detail.turns
        .filter((t) => t.conversation === id)
        .map((turn) => {
          const author = turn.author?.name ?? "You";
          return {
            at: turn.createdAt,
            item: { kind: "message" as const, author, initials: words.initials(author), time: words.hm(turn.createdAt), text: turn.prompt, queued: turn.status === "queued", cancel: false, turnId: turn.id, to: sentTo },
            sent: (send: EventRecord) => turn.events.some((e) => e.id === send.id),
          };
        }),
      ...steers.map((steer) => {
        const author = steer.author?.name ?? "You";
        const turn = turnOf(steer);
        const next = steers.find((x) => x.createdAt > steer.createdAt && turnOf(x) === turn);
        return {
          at: steer.createdAt,
          item: { kind: "message" as const, author, initials: words.initials(author), time: words.hm(steer.createdAt), text: steer.content, queued: false, cancel: false, to: sentTo },
          sent: (send: EventRecord) => !!turn?.events.some((e) => e.id === send.id) && send.createdAt >= steer.createdAt && (!next || send.createdAt < next.createdAt),
        };
      }),
    ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const stretches: [Extract<TranscriptItem, { kind: "message" }> | undefined, EventRecord[]][] = [
      [undefined, mine.filter((e) => e.parentToolUseId === id)],
      ...messages.map((m): [Extract<TranscriptItem, { kind: "message" }>, EventRecord[]] => {
        const sent = new Set(sends.filter(m.sent).flatMap((s) => (s.toolUseId ? [s.toolUseId] : [])));
        return [m.item, mine.filter((e) => e.parentToolUseId && sent.has(e.parentToolUseId))];
      }),
    ];
    stretches.forEach(([message, events], i) => {
      if (message) out.push([message]);
      const answer = answers[i];
      const box = Transcript.work(events, all, found, state === "running" && answer === undefined, false, branch);
      if (answer !== undefined) box.push({ kind: "prose", text: answer });
      if (box.length) out.push([{ kind: "agent", name, time: words.hm(events[0]?.createdAt ?? call.createdAt) }, ...box]);
    });
    // The server's word when the agent did not pass a message on, on the relay turn or the steered one.
    const lost = detail.turns
      .filter((t) => t.conversation === id || steers.some((x) => turnOf(x) === t))
      .flatMap((t) => t.events.filter((e) => e.kind === "notice" && e.content.startsWith(unrelayedNotice) && e.content.includes(name)));
    for (const notice of lost) out.push([{ kind: "notice", text: notice.content, tone: "orange" }]);
    if (state === "running") out.push([{ kind: "working", text: `${name} is working` }]);
    else if (state === "failed") out.push([{ kind: "notice", title: `${name} stopped`, text: cut(answers[answers.length - 1] ?? "", 400), tone: "red" }]);
    return { name, groups: out };
  },

  // `Turn.parts`: consecutive events of one part fold together; results, statuses, thinking, notices, tasks and
  // pending calls are not drawn here.
  parts(events: EventRecord[]): [string, EventRecord[]][] {
    const shown = events.filter(
      (e) => !["tool_result", "status", "result", "thinking", "notice", "task"].includes(e.kind) && e.approvalStatus !== "pending" && !(e.kind === "tool_use" && e.tool === "ToolSearch"),
    );
    const out: [string, EventRecord[]][] = [];
    for (const e of shown) {
      const p = Transcript.part(e);
      const last = out[out.length - 1];
      if (last && last[0] === p) last[1].push(e);
      else out.push([p, [e]]);
    }
    return out;
  },

  // `Event#part`.
  part(e: EventRecord): string {
    if (e.approvalStatus) return "gate";
    if (e.kind === "tool_use" && ["Task", "Agent"].includes(e.tool ?? "")) return "subagents";
    if (e.kind === "tool_use" && Tools.name(e.tool) === "start_step") return "steps";
    if (e.kind === "tool_use" && (e.tool ?? "").startsWith(Tools.phase)) return "phases";
    if (e.kind === "tool_use") return "tools";
    return e.kind;
  },

  row(call: EventRecord, found: Map<string, EventRecord>, live: boolean, branch: string): RunRow {
    const result = call.toolUseId ? found.get(call.toolUseId) : undefined;
    const report = call.outcome ?? result?.content ?? "";
    const phase = (call.tool ?? "").startsWith(Tools.phase);
    let state: ActState;
    if (live && !result && !call.outcome) state = "running";
    else if (phase && report && report !== "done") state = "failed";
    else if (report.includes(" failed: ") || report.includes(": not allowed")) state = "failed";
    else state = "done";
    const n = Tools.name(call.tool);
    const described = n === "Bash" ? text(Tools.input(call).description) : undefined;
    const label = described ? cut(described, 48) : Tools.label(call);
    const time = result ? words.took(words.between(call.createdAt, result.createdAt)) : undefined;
    const outcome: ActOutcome = state === "running" ? { kind: "value", text: "running" } : time ? { kind: "value", text: time } : { kind: "none" };
    // `RunsHelper#run_output`: nothing printed while it runs; a phase that reports "done" says nothing more.
    const output = state === "running" || (phase && report === "done") ? undefined : report || undefined;
    // A phase's label is a sentence: it takes the target's room, the command it ran after it.
    if (phase) {
      const command = Tools.command(call);
      return { face: Tools.face(call.tool), label: "Machine", mono: false, target: command ? `${label} · ${command}` : label, outcome, state, detail: output ? { output } : undefined };
    }
    const mono = n !== "set_title" && n !== "create_pull_request";
    const target = Tools.command(call);
    return { face: Tools.face(call.tool), label, mono, target, outcome, state, detail: Tools.detail(call, target, mono, output) };
  },

  // `RunsHelper#subagents`: each sub-agent's name, state, last line and facts, from its call, its result and the
  // `task` lines that report on it.
  subagents(calls: EventRecord[], events: EventRecord[], found: Map<string, EventRecord>, live: boolean): SubagentRun[] {
    return calls.map((call) => {
      const input = Tools.input(call);
      const name = [text(input.description), text(input.subagent_type)].find((s) => s) ?? "sub-agent";
      const reports = call.toolUseId ? tasks(events, [call.toolUseId]) : [];
      const task = reports[reports.length - 1] ?? {};
      let state: SubagentRun["state"];
      if (task.state === "notification") state = task.status === "completed" ? "done" : "failed";
      else state = live ? "running" : "done";
      const result = call.toolUseId ? found.get(call.toolUseId) : undefined;
      let said = call.outcome ?? result?.content ?? "";
      if (/agentId: \w+/.test(said)) said = "";
      const answer = reports.flatMap((t) => (text(t.summary) ? [t.summary as string] : [])).pop() ?? said;
      const summary = answer.split("\n").map((l) => l.trim()).find((l) => l);
      const doing = text(task.activity) || "starting";
      const line = state === "running" ? doing : summary ?? "";
      // `Subagent#took`: from its call to the line that ends it. An async call answers at once, so its result says
      // when it started; without an ending line, the last thing it did. While it runs, the time so far, to its last line.
      const lines = call.toolUseId ? events.filter((e) => e.kind === "task" && e.toolUseId === call.toolUseId).sort(by) : [];
      const ended = [...lines].reverse().find((e) => json(e.content).state === "notification");
      const nested = call.toolUseId ? events.filter((e) => e.parentToolUseId === call.toolUseId && e.kind !== "steer") : [];
      const last = ended ?? [...(result ? [result] : []), ...lines, ...nested].sort(by).pop();
      const time = last ? words.took(words.between(call.createdAt, last.createdAt)) : undefined;
      const tools = typeof task.tools === "number" ? words.plural(task.tools, "tool") : undefined;
      const tokens = typeof task.tokens === "number" ? words.tokens(task.tokens) : undefined;
      const facts = [time, tools, tokens].filter(Boolean).join(" · ");
      return { id: call.toolUseId ?? call.id, name, line: cut(line, 140), state, facts: facts || undefined };
    });
  },

  // `RunsHelper#step_cards`: the steps a run of `start_step` calls handed on, with what each was told.
  steps(calls: EventRecord[], found: Map<string, EventRecord>, live: boolean): SubagentRun[] {
    return calls.map((call) => {
      const input = Tools.input(call);
      const result = call.toolUseId ? found.get(call.toolUseId) : undefined;
      const time = result ? words.took(words.between(call.createdAt, result.createdAt)) : undefined;
      return {
        id: call.toolUseId ?? call.id,
        name: `Step ${input.step ?? ""}`,
        line: cut(text(input.message) ?? "", 140),
        state: live && !result ? "running" : "done",
        facts: time,
      };
    });
  },

  // `RunsHelper#setup_summary`.
  setupSummary(calls: EventRecord[], rows: RunRow[], setup: boolean, resumed = false) {
    const failed = calls.filter((_, i) => rows[i].state === "failed");
    const commands = failed.filter((c) => c.tool === Tools.phase + "setup").length;
    if (failed.length > commands) return "Machine setup failed";
    if (setup) return resumed ? "Starting the machine" : "Setting up the machine";
    return commands === 0 ? "Machine ready" : `Machine ready · ${words.plural(commands, "setup command")} failed`;
  },

  // `RunsHelper#runs_took`: from the first call to the last result.
  took(calls: EventRecord[], found: Map<string, EventRecord>) {
    const ends = calls.flatMap((c) => (c.toolUseId && found.get(c.toolUseId) ? [Date.parse(found.get(c.toolUseId)!.createdAt)] : []));
    if (!ends.length || !calls.length) return undefined;
    return words.took((Math.max(...ends) - Date.parse(calls[0].createdAt)) / 1000);
  },

  // `TurnsHelper#turn_failure`: why a failed turn stopped and what fixes it, from its last error.
  failure(events: EventRecord[], agent: string): { title: string; text: string; action?: string } {
    const said = [...events].reverse().find((e) => e.kind === "error")?.content ?? "";
    const setup = said.startsWith("The machine could not be started");
    const vendor = "(hetzner|daytona|boat\\.dev|e2b)";
    const matches = (pattern: string) => new RegExp(pattern).test(said);
    if (setup && matches(`\\b${vendor} [A-Z]+ \\S+ (401|403)\\b`)) {
      return { title: "nvoi could not start the machine", text: "The machine provider refused nvoi's own key. This is on nvoi's side, not your environment's. Send a message to try again once it is fixed." };
    }
    if (setup && matches(`\\b${vendor} (unreachable|[A-Z]+ \\S+ (429|5\\d\\d)\\b)`)) {
      return { title: "The machine provider did not answer", text: "nvoi tried again several times. Nothing in your environment is at fault. Send a message to try again." };
    }
    if (setup) {
      return { title: "The machine could not start", text: "A setup command or a variable of the environment failed. Fix it, then send a message to try again.", action: "Open the environment" };
    }
    if (said.startsWith("nvoi could not run the turn")) {
      return { title: "Something failed on nvoi's side", text: "The agent was not at fault and nothing it changed is lost. Send a message to try again." };
    }
    if (matches("\\bmodel credential\\b")) {
      return { title: "No model credential to run the agent with", text: "Add a model credential to this workspace, then send a message to try again.", action: "Add a credential" };
    }
    if (matches("exited 127\\b|command not found|claude: not found")) {
      return { title: `${agent} is not installed on the machine`, text: "Add it to the environment's setup commands, then send a message to try again.", action: "Open the environment" };
    }
    return { title: "The agent stopped", text: "Send a message to pick the work back up." };
  },

  // `WorktreeSession#activity`: what the working line says, nothing when nothing happens.
  // The machine was set up for an earlier turn that ended (before `turn`, else any): starting it now brings it back.
  resumed(detail: SessionDetail, turn?: TurnRecord) {
    return detail.turns.some((t) => ["succeeded", "failed", "cancelled"].includes(t.status) && t.id !== turn?.id && (!turn || t.createdAt < turn.createdAt));
  },

  activity(detail: SessionDetail): { kind: "working" | "waiting" | "preparing"; since: string } | undefined {
    const turns = detail.turns;
    const current = turns.find((t) => ["pending", "running"].includes(t.status)) ?? turns.find((t) => t.status === "awaiting_approval");
    const queued = turns.filter((t) => t.status === "queued").sort(by)[0];
    const state = detail.session.worktree.state;
    if (current && ["pending", "running"].includes(current.status)) return { kind: "working", since: Transcript.since(current) };
    if (current?.status === "awaiting_approval") {
      if (Transcript.pending(detail).length) return { kind: "waiting", since: Transcript.since(current, true) };
      return { kind: state === "starting" ? "preparing" : "working", since: Transcript.since(current) };
    }
    if (queued && state !== "running") return { kind: "preparing", since: queued.createdAt };
    return undefined;
  },

  // When the state the working line names began, as `turn.updated_at` says it on the web: the agent started
  // (its first line, the `status` init, after the machine's phases), or the turn stopped on a call waiting on a
  // person (its last result line, else the call). Not its last event: the time would start over on every line.
  since(turn: TurnRecord, waiting = false) {
    const events = [...turn.events].sort(by);
    if (waiting) {
      const parked = [...events].reverse().find((e) => e.kind === "result") ?? events.find((e) => e.approvalStatus === "pending");
      if (parked) return parked.createdAt;
    }
    // Before its first line, only the machine's phases are there: the agent starts when the last one ends.
    const started = events.find((e) => e.kind === "status") ?? events[events.length - 1];
    return started?.createdAt ?? turn.createdAt;
  },

  // `TurnResource.requested_by` as names; none for a turn nvoi made.
  requesters(turn: TurnRecord) {
    const names = (turn.requestedBy ?? []).map((a) => a.name);
    return names.length ? names : undefined;
  },

  // `WorktreeSession#pending`: calls waiting on a person, oldest first, each with whose turn asked it.
  pending(detail: SessionDetail): PendingCall[] {
    return detail.turns
      .flatMap((t) => t.events.map((call) => ({ call, turn: t })))
      .filter(({ call: e }) => e.kind === "tool_use" && e.approvalStatus === "pending")
      .sort((a, b) => by(a.call, b.call))
      .map(({ call, turn }) => {
        const question = Tools.name(call.tool) === "ask_user";
        const names = Transcript.requesters(turn);
        // An approval reads as the call exactly as it will run, its tool beside it (`ds/gate`).
        return {
          toolUseId: call.toolUseId ?? call.id,
          question,
          title: question ? Tools.excerpt(call) : Tools.action(call, detail.session.worktree.branch),
          detail: question ? "" : Tools.label(call),
          questions: Tools.questions(call),
          asked: names ? `For ${nameList(names)}` : undefined,
        };
      });
  },

  // Turns as the sample model of the shell describes them.
  fromParts(parts: Part[]): TranscriptItem[][] {
    const out: TranscriptItem[][] = [];
    for (const part of parts) {
      let item: TranscriptItem;
      switch (part.kind) {
        case "message":
          item = { kind: "message", author: part.author, initials: part.initials, time: part.time, text: part.text, queued: false, cancel: false };
          break;
        case "agent":
          item = { kind: "agent", name: part.name, time: part.time };
          break;
        case "prose":
          item = { kind: "prose", text: part.text };
          break;
        case "actions":
          item = {
            kind: "run", summary: part.summary, time: part.time,
            rows: part.actions.map((a) => ({ face: Tool.face(a.tool), label: Tool.label(a.tool), mono: Tool.mono(a.tool), target: a.target, outcome: a.outcome ?? { kind: "none" }, state: a.state ?? "done" })),
          };
          break;
        case "note":
          item = { kind: "note", id: part.time, author: part.author, initials: part.initials, time: part.time, text: part.text, replies: [], sent: false };
          break;
        case "artifact":
          item = { kind: "artifact", artifact: part.artifact };
          break;
      }
      if (part.kind === "message" || part.kind === "agent" || part.kind === "note" || !out.length) out.push([item]);
      else out[out.length - 1].push(item);
    }
    return out;
  },
};
