import type { Approval, Event, Task } from "@/contexts/api/types";

// What a person reads, folded from what the agent printed: messages, turns with their calls and sub-agents,
// and the plane's follow-up prompts attached to the calls they answer.

export const OUTCOME = "Outcome of the actions you asked for:";
const RELAY = /^The user wrote to your sub-agent "(.*?)"\. Continue it with SendMessage to: '(\w+)'[\s\S]*?\n\nTheir message:\n([\s\S]*)$/;
const AGENT_ID = /agentId: (\w+)/;
const SPAWN = new Set(["Task", "Agent"]);
export const NVOI = "mcp__nvoi__";

export type Call = { id: string; tool: string; input: string; result?: string; at?: string };

export type Part = { kind: "prose"; text: string } | { kind: "call"; call: Call };

export type Action = Call & { name: string; state: "pending" | "done" | "denied" | "stopped" | "failed" | "running"; outcome?: string; approval?: Approval };

export type SubState = "running" | "done" | "failed";

export type Sub = {
  id: string;
  name: string;
  type?: string;
  prompt: string;
  agentId?: string;
  state: SubState;
  last: string;
  tokens?: number;
  tools?: number;
  duration?: number;
  at?: string;
  events: Event[];
  waiting: boolean;
};

export type Turn = {
  key: string;
  at?: string;
  duration?: number;
  tokens?: number;
  parts: Part[];
  actions: Action[];
  subs: Sub[];
  error?: string;
  live: boolean;
};

export type Item =
  | { kind: "you"; key: string; text: string; at?: string; to?: string }
  | { kind: "turn"; key: string; turn: Turn }
  | { kind: "notice"; key: string; text: string }
  | { kind: "stopped"; key: string };

function input(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function field(raw: string, ...names: string[]): string {
  const v = input(raw);
  for (const n of names) if (typeof v[n] === "string" && v[n]) return v[n] as string;
  return "";
}

function outcomes(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const line of text.slice(OUTCOME.length).trim().split("\n")) {
    const i = line.indexOf(": ");
    if (i < 0) continue;
    const name = line.slice(0, i);
    out.set(name, [...(out.get(name) ?? []), line.slice(i + 2)]);
  }
  return out;
}

// How the plane words an outcome: "denied by the user", "refused by policy", "stopped by the user", "failed: ...",
// "push failed: ...", "a path starting with / is needed", "unknown tool"; anything else is the action done.
export function settle(said: string): "done" | "denied" | "stopped" | "failed" {
  if (/^(denied|refused)\b/.test(said)) return "denied";
  if (/^stopped\b/.test(said)) return "stopped";
  if (/^(push )?failed:|^unknown tool$|^a path starting with \/ is needed$/.test(said)) return "failed";
  return "done";
}

// The page the agent last asked the preview to show, once the plane said it did: a denied or failed call is not
// shown. The plane answers every nvoi call of a turn in order, sub-agents' included, one line each.
export function shownPage(events: Event[]): { id: string; path: string } | undefined {
  const waiting: Event[] = [];
  let shown: { id: string; path: string } | undefined;
  for (const e of events) {
    if (e.kind === "tool_use" && e.tool === NVOI + "navigate_preview") waiting.push(e);
    else if (e.kind === "prompt" && e.content?.startsWith(OUTCOME)) {
      for (const said of outcomes(e.content).get("navigate_preview") ?? []) {
        const call = waiting.shift();
        if (!call) break;
        const path = field(call.content ?? "", "path");
        if (settle(said) === "done" && path) shown = { id: call.tool_id ?? path, path };
      }
    } else if (e.kind === "prompt" || e.kind === "stopped") {
      // A new turn or a stop: calls still unanswered never will be.
      waiting.length = 0;
    }
  }
  return shown;
}

function firstLine(s = "") {
  return s.replace(/agentId: \w+[\s\S]*$/, "").trim().split("\n").find((l) => l.trim()) ?? "";
}

// running: the session is live and this is its latest turn. pending: approvals still open for this session.
export function transcript(events: Event[], running: boolean, pending: Approval[] = []): Item[] {
  const items: Item[] = [];
  const calls = new Map<string, Call>();
  const subs = new Map<string, Sub>();
  const owner = new Map<string, string>();
  const tasks = new Map<string, Task>();
  const turns: Turn[] = [];
  let turn: Turn | undefined;
  let waiting: Action[] = [];

  const open = (key: string, at?: string) => {
    turn = { key, at, parts: [], actions: [], subs: [], live: false };
    turns.push(turn);
    items.push({ kind: "turn", key, turn });
    return turn;
  };

  events.forEach((e, i) => {
    const key = String(i);
    if (e.kind === "prompt") {
      const text = e.content ?? "";
      if (text.startsWith(OUTCOME)) {
        const byName = outcomes(text);
        for (const a of waiting) {
          const said = byName.get(a.name)?.shift();
          if (said === undefined) continue;
          a.outcome = said;
          a.state = settle(said);
        }
        waiting = waiting.filter((a) => a.state === "pending" || a.state === "running");
      } else {
        const relay = RELAY.exec(text);
        items.push(relay ? { kind: "you", key, text: relay[3], at: e.at, to: relay[1] } : { kind: "you", key, text, at: e.at });
      }
      turn = undefined;
      return;
    }
    if (e.parent) {
      // A sub-agent's nvoi call takes its place in the order the outcome prompt answers calls in.
      if (e.kind === "tool_use" && e.tool?.startsWith(NVOI)) {
        waiting.push({ id: e.tool_id ?? key, tool: e.tool, input: e.content ?? "", name: e.tool.slice(NVOI.length), state: "running" });
      }
      const sid = owner.get(e.parent) ?? e.parent;
      const sub = subs.get(sid);
      if (sub) {
        sub.events.push(e);
        if (e.kind === "tool_use" && e.tool_id) owner.set(e.tool_id, sid);
      }
      return;
    }
    if (e.kind === "task") {
      if (!e.tool_id) return;
      const prev = tasks.get(e.tool_id) ?? {};
      const next = input(e.content ?? "{}") as Task;
      tasks.set(e.tool_id, { ...prev, ...next, activity: next.state === "progress" ? next.activity : prev.activity });
      return;
    }
    if (e.kind === "status" || e.kind === "thinking") return;
    if (e.kind === "stopped") {
      items.push({ kind: "stopped", key });
      turn = undefined;
      return;
    }
    if (e.kind === "notice") {
      if (e.content?.trim()) items.push({ kind: "notice", key, text: e.content });
      return;
    }
    const t = turn ?? open(key, e.at);
    switch (e.kind) {
      case "message": {
        const last = t.parts[t.parts.length - 1];
        if (last?.kind === "prose") last.text += "\n\n" + (e.content ?? "");
        else t.parts.push({ kind: "prose", text: e.content ?? "" });
        return;
      }
      case "tool_use": {
        const call: Call = { id: e.tool_id ?? key, tool: e.tool ?? "", input: e.content ?? "", at: e.at };
        calls.set(call.id, call);
        if (SPAWN.has(call.tool)) {
          const sub: Sub = {
            id: call.id,
            name: field(call.input, "description", "subagent_type") || "sub-agent",
            type: field(call.input, "subagent_type") || undefined,
            prompt: field(call.input, "prompt"),
            state: "running",
            last: "starting",
            at: e.at,
            events: [],
            waiting: false,
          };
          subs.set(sub.id, sub);
          t.subs.push(sub);
          return;
        }
        if (call.tool === "SendMessage") {
          const to = field(call.input, "to");
          const sub = [...subs.values()].find((s) => s.agentId && s.agentId === to);
          if (sub) owner.set(call.id, sub.id);
        }
        if (call.tool.startsWith(NVOI)) {
          const name = call.tool.slice(NVOI.length);
          const approval = pending.find((a) => a.tool === name && a.input === call.input);
          const action: Action = { ...call, name, state: approval ? "pending" : "running", approval };
          t.actions.push(action);
          waiting.push(action);
          return;
        }
        t.parts.push({ kind: "call", call });
        return;
      }
      case "tool_result": {
        const call = calls.get(e.tool_id ?? "");
        if (call) call.result = e.content ?? "";
        const sub = subs.get(e.tool_id ?? "");
        if (sub) sub.agentId = AGENT_ID.exec(e.content ?? "")?.[1];
        return;
      }
      case "result":
        t.duration = e.meta?.duration_ms;
        t.tokens = e.meta?.tokens;
        turn = undefined;
        return;
      case "error":
        t.error = e.content ?? "";
        turn = undefined;
        return;
    }
  });

  const latest = turns[turns.length - 1];
  if (latest && running && items[items.length - 1]?.kind === "turn") latest.live = true;
  for (const t of turns) {
    for (const a of t.actions) if (a.state === "running" && !t.live) a.state = "done";
    for (const s of t.subs) {
      const task = tasks.get(s.id) ?? {};
      const call = calls.get(s.id);
      s.tokens = task.tokens;
      s.tools = task.tools;
      s.duration = task.duration_ms;
      s.waiting = pending.some((a) => s.events.some((e) => e.kind === "tool_use" && e.tool === NVOI + a.tool && e.content === a.input));
      if (task.state === "notification") s.state = task.status === "completed" ? "done" : "failed";
      else if (call?.result !== undefined || !t.live) s.state = "done";
      else s.state = "running";
      s.last =
        s.state === "running"
          ? task.activity || task.last_tool || "starting"
          : s.state === "failed"
            ? "failed"
            : firstLine(task.summary) || firstLine(call?.result) || "done";
    }
  }
  return items;
}

export function allSubs(items: Item[]): Sub[] {
  return items.flatMap((i) => (i.kind === "turn" ? i.turn.subs : []));
}

// A sub-agent's own conversation, read as one turn signed by it. Its nvoi actions are answered in the parent's outcome
// prompt, which the plane words for every call of the turn, sub-agents' included.
export function subTranscript(sub: Sub, running: boolean, pending: Approval[] = [], outcome?: Event): Item[] {
  const own = sub.events.map((e) => ({ ...e, parent: undefined }));
  const inner = transcript(outcome ? [...own, outcome] : own, running && sub.state === "running", pending);
  return inner.map((i) => (i.kind === "turn" ? { ...i, turn: { ...i.turn, live: sub.state === "running" } } : i));
}

// The outcome prompt that answered the turn a sub-agent ran in, if any.
export function outcomeFor(events: Event[], sub: Sub): Event | undefined {
  const at = events.findIndex((e) => e.kind === "tool_use" && e.tool_id === sub.id);
  if (at < 0) return undefined;
  for (const e of events.slice(at + 1)) {
    if (e.kind !== "prompt" || e.parent) continue;
    return e.content?.startsWith(OUTCOME) ? e : undefined;
  }
  return undefined;
}
