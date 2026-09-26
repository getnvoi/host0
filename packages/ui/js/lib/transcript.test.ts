import { AGAIN, allSubs, settle, shownPage, subTranscript, transcript } from "@/lib/transcript";
import type { Approval, Event } from "@/contexts/api/types";

const turn: Event[] = [
  { kind: "prompt", content: "add /health", at: "2026-09-25T14:02:00Z" },
  { kind: "status", content: "init" },
  { kind: "message", content: "Looking." },
  { kind: "tool_use", tool: "Bash", tool_id: "t1", content: '{"command":"ls"}' },
  { kind: "tool_result", tool_id: "t1", content: "app" },
  { kind: "tool_use", tool: "Task", tool_id: "s1", content: '{"description":"map-routes","prompt":"list the routes"}' },
  { kind: "message", parent: "s1", content: "Reading config/routes.rb" },
  { kind: "tool_use", parent: "s1", tool: "Read", tool_id: "r1", content: '{"file_path":"config/routes.rb"}' },
  { kind: "task", tool_id: "s1", content: '{"state":"notification","status":"completed","tokens":1800,"tools":2,"duration_ms":4000}' },
  { kind: "tool_result", tool_id: "s1", content: "No namespaces.\nagentId: abc123" },
  { kind: "message", content: "Added the route." },
  { kind: "tool_use", tool: "mcp__nvoi__create_pull_request", tool_id: "p1", content: '{"title":"Add /health","body":"b"}' },
  { kind: "message", content: "I asked to open the pull request." },
  { kind: "result", content: "done", meta: { duration_ms: 38000, tokens: 21400 } },
];

test("folds a turn: calls before the answer, sub-agents apart, nvoi actions last", () => {
  const items = transcript(turn, false);
  expect(items.map((i) => i.kind)).toEqual(["you", "turn"]);
  const t = items[1].kind === "turn" ? items[1].turn : undefined;
  expect(t?.parts.map((p) => p.kind)).toEqual(["prose", "call", "prose"]);
  expect(t?.subs).toHaveLength(1);
  expect(t?.subs[0]).toMatchObject({ name: "map-routes", agentId: "abc123", state: "done", last: "No namespaces.", tools: 2 });
  expect(t?.actions[0]).toMatchObject({ name: "create_pull_request", state: "done" });
  expect(t?.duration).toBe(38000);
});

test("an open approval marks its action pending; the outcome settles it", () => {
  const pending: Approval[] = [{ id: "a", session: "x", tool: "create_pull_request", input: '{"title":"Add /health","body":"b"}', state: "pending" }];
  const waiting = transcript(turn, false, pending);
  const t = waiting[1].kind === "turn" ? waiting[1].turn : undefined;
  expect(t?.actions[0].state).toBe("pending");
  const decided = transcript([...turn, { kind: "prompt", content: "Outcome of the actions you asked for:\ncreate_pull_request: denied by the user" }], false);
  const d = decided[1].kind === "turn" ? decided[1].turn : undefined;
  expect(d?.actions[0]).toMatchObject({ state: "denied", outcome: "denied by the user" });
  expect(decided).toHaveLength(2);
});

test("a relayed message reads as the person's own, to the sub-agent", () => {
  const relay = `The user wrote to your sub-agent "map-routes". Continue it with SendMessage to: 'abc123', passing their message as it is, then tell them what it answered.\n\nTheir message:\nand the tests?`;
  const items = transcript([...turn, { kind: "prompt", content: relay }], false);
  expect(items[2]).toMatchObject({ kind: "you", text: "and the tests?", to: "map-routes" });
});

test("a sub-agent's conversation reads as its own turn, and a live one runs", () => {
  const live = turn.slice(0, 8);
  const items = transcript(live, true);
  const sub = allSubs(items)[0];
  expect(sub.state).toBe("running");
  const own = subTranscript(sub, true);
  const t = own[0].kind === "turn" ? own[0].turn : undefined;
  expect(t?.parts.map((p) => p.kind)).toEqual(["prose", "call"]);
  expect(t?.live).toBe(true);
});

test("a failed push or pull request reads as failed, not done", () => {
  const push: Event[] = [
    { kind: "prompt", content: "push it" },
    { kind: "tool_use", tool: "mcp__nvoi__push_branch", tool_id: "p", content: "{}" },
    { kind: "tool_use", tool: "mcp__nvoi__create_pull_request", tool_id: "q", content: '{"title":"t"}' },
    { kind: "result", content: "done" },
    { kind: "prompt", content: "Outcome of the actions you asked for:\npush_branch: failed: exit 128\ncreate_pull_request: push failed: exit 128" },
  ];
  const t = transcript(push, false)[1];
  const actions = t.kind === "turn" ? t.turn.actions : [];
  expect(actions.map((a) => a.state)).toEqual(["failed", "failed"]);
  expect(settle("opened https://github.com/o/r/pull/1")).toBe("done");
  expect(settle("refused by policy")).toBe("denied");
});

test("the preview shows only a page the plane said it showed", () => {
  const nav = (id: string, path: string): Event => ({ kind: "tool_use", tool: "mcp__nvoi__navigate_preview", tool_id: id, content: JSON.stringify({ path }) });
  const outcome = (...lines: string[]): Event => ({ kind: "prompt", content: ["Outcome of the actions you asked for:", ...lines].join("\n") });
  expect(shownPage([nav("a", "/a")])).toBeUndefined();
  expect(shownPage([nav("a", "/a"), outcome("navigate_preview: the preview shows /a")])).toEqual({ id: "a", path: "/a" });
  expect(shownPage([nav("a", "/a"), outcome("navigate_preview: the preview shows /a"), nav("b", "/b"), outcome("navigate_preview: denied by the user")])).toEqual({ id: "a", path: "/a" });
  expect(shownPage([nav("c", "c"), outcome("navigate_preview: a path starting with / is needed")])).toBeUndefined();
  expect(shownPage([nav("d", "/d"), { kind: "stopped" }, outcome("navigate_preview: the preview shows /x")])).toBeUndefined();
});

test("a call left without a result stops being live once its turn ended", () => {
  const cut: Event[] = [
    { kind: "prompt", content: "go" },
    { kind: "tool_use", tool: "Bash", tool_id: "b", content: '{"command":"sleep 100"}' },
  ];
  const live = transcript(cut, true)[1];
  expect(live.kind === "turn" && live.turn.live).toBe(true);
  const ended = transcript([...cut, { kind: "error", content: "killed" }], false)[1];
  expect(ended.kind === "turn" && ended.turn.live).toBe(false);
});

test("outcomes read like the plane words them", () => {
  expect(settle("stopped by the user")).toBe("stopped");
  expect(settle("the preview shows /checkout/failed")).toBe("done");
  expect(settle("failed: exit 128")).toBe("failed");
  expect(settle("push failed: exit 128")).toBe("failed");
  expect(settle("a path starting with / is needed")).toBe("failed");
});

test("a sub-agent's call takes its own outcome, not the main agent's", () => {
  const events: Event[] = [
    { kind: "prompt", content: "go" },
    { kind: "tool_use", tool: "Task", tool_id: "s", content: '{"description":"helper"}' },
    { kind: "tool_use", tool: "mcp__nvoi__push_branch", tool_id: "sp", content: "{}", parent: "s" },
    { kind: "tool_use", tool: "mcp__nvoi__push_branch", tool_id: "mp", content: "{}" },
    { kind: "result", content: "done" },
    { kind: "prompt", content: "Outcome of the actions you asked for:\npush_branch: failed: exit 1\npush_branch: pushed nvoi/x" },
  ];
  const t = transcript(events, false)[1];
  const actions = t.kind === "turn" ? t.turn.actions : [];
  expect(actions.map((a) => a.state)).toEqual(["done"]);
});

test("the plane's resume after a network error is not shown as your message", () => {
  const items = transcript([{ kind: "prompt", content: "go" }, { kind: "notice", content: "retrying" }, { kind: "prompt", content: AGAIN }], false);
  expect(items.filter((i) => i.kind === "you")).toHaveLength(1);
});
