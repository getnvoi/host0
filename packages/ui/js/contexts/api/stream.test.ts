import { QueryClient } from "@tanstack/react-query";
import { apply, splice } from "@/contexts/api/stream";
import { queueKey, sessionKey } from "@/contexts/api/sessions";
import type { Event, Session, Summary } from "@/contexts/api/types";

const ev = (content: string): Event => ({ kind: "message", content });

const sum: Summary = { id: "s", env: "e", branch: "b", preview: "p", state: "running", prompt: "go", queued: 0, at: "", last: "" };
const session = (events: Event[]): Session => ({ id: "s", env: "e", branch: "b", preview: "p", state: "running", at: "", last: "", turns: 1, events });

test("splice writes from the index, replaces what follows, refuses a gap", () => {
  const cached = [ev("a"), ev("b"), ev("c")];
  expect(splice(cached, 3, [ev("d")])?.map((e) => e.content)).toEqual(["a", "b", "c", "d"]);
  expect(splice(cached, 1, [ev("B")])?.map((e) => e.content)).toEqual(["a", "B"]);
  expect(splice(cached, 0, [ev("x")])?.map((e) => e.content)).toEqual(["x"]);
  expect(splice(cached, 4, [ev("e")])).toBeUndefined();
});

test("an update without from starts at zero", () => {
  const client = new QueryClient();
  client.setQueryData(sessionKey("s"), session([ev("old")]));
  apply(client, { kind: "session", session: sum, events: [ev("new")] });
  expect(client.getQueryData<Session>(sessionKey("s"))?.events.map((e) => e.content)).toEqual(["new"]);
});

test("a gap keeps the cache and marks the session for a read", () => {
  const client = new QueryClient();
  client.setQueryData(sessionKey("s"), session([ev("a")]));
  apply(client, { kind: "session", session: sum, from: 5, events: [ev("f")] });
  expect(client.getQueryData<Session>(sessionKey("s"))?.events.map((e) => e.content)).toEqual(["a"]);
  expect(client.getQueryState(sessionKey("s"))?.isInvalidated).toBe(true);
});

test("the queue is read again only when its length or the state moves", () => {
  const client = new QueryClient();
  const seen = new Map<string, string>();
  client.setQueryData(queueKey("s"), []);
  const stale = () => client.getQueryState(queueKey("s"))?.isInvalidated;
  apply(client, { kind: "session", session: sum }, seen);
  expect(stale()).toBe(true);
  client.setQueryData(queueKey("s"), []);
  apply(client, { kind: "session", session: sum, events: [] }, seen);
  expect(stale()).toBe(false);
  apply(client, { kind: "session", session: { ...sum, queued: 1 } }, seen);
  expect(stale()).toBe(true);
});
