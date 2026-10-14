import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/contexts/api/client";
import { StreamError, transport } from "@/contexts/api/transport";
import { approvalsKey, changesKey, queueKey, sessionKey, sessionsKey } from "@/contexts/api/sessions";
import type { Event, Session, Summary, Update } from "@/contexts/api/types";
import { backoff } from "@/lib/backoff";

// One stream for the whole app. It reconnects with the last id it saw, so the plane replays what was missed; a reset
// means it could not, and every query is refetched. A stream refused (other than 200) is opened again without an id.
export type Link = "connecting" | "open" | "reconnecting";

const LinkContext = createContext<Link>("connecting");

export function useLink() {
  return useContext(LinkContext);
}

// The cached events with the incoming ones written from index from; undefined when they would leave a gap.
export function splice(events: Event[], from: number, incoming: Event[]): Event[] | undefined {
  if (from > events.length) return undefined;
  return [...events.slice(0, from), ...incoming];
}

// Queries with a read already promised for when their current one lands.
const following = new WeakSet<object>();

// Reads the session again. A read already in flight may predate the update, so one more follows when it lands.
function refresh(client: QueryClient, id: string) {
  const key = sessionKey(id);
  const query = client.getQueryCache().find({ queryKey: key, exact: true });
  if (query?.state.fetchStatus !== "fetching") {
    client.invalidateQueries({ queryKey: key, exact: true });
    return;
  }
  if (following.has(query)) return;
  following.add(query);
  const stop = client.getQueryCache().subscribe((e) => {
    if (e.query !== query || e.query.state.fetchStatus === "fetching") return;
    stop();
    following.delete(query);
    client.invalidateQueries({ queryKey: key, exact: true });
  });
}

// seen holds each session's queue length and state as last streamed: the queue is read again only when they move.
export function apply(client: QueryClient, u: Update, seen: Map<string, string> = new Map()) {
  switch (u.kind) {
    case "reset":
      client.invalidateQueries();
      return;
    case "approval":
      client.invalidateQueries({ queryKey: approvalsKey });
      return;
    case "session": {
      const sum = u.session;
      client.setQueryData<Summary[]>(sessionsKey, (list) => {
        if (!list) return list;
        const rest = list.filter((s) => s.id !== sum.id);
        return [sum, ...rest].sort((a, b) => b.last.localeCompare(a.last));
      });
      const mark = `${sum.queued}:${sum.state}`;
      if (seen.get(sum.id) !== mark) {
        seen.set(sum.id, mark);
        client.invalidateQueries({ queryKey: queueKey(sum.id) });
      }
      const key = sessionKey(sum.id);
      const cached = client.getQueryData<Session>(key);
      if (!cached) {
        refresh(client, sum.id);
        return;
      }
      // A session whose state moved may have changed files: the diff is read again.
      if (cached.state !== sum.state) client.invalidateQueries({ queryKey: changesKey(sum.id) });
      const events = u.events ? splice(cached.events, u.from ?? 0, u.events) : cached.events;
      if (!events) {
        refresh(client, sum.id);
        return;
      }
      // A read in flight would land older than this; the update stands in for it.
      client.cancelQueries({ queryKey: key, exact: true });
      client.setQueryData<Session>(key, (s) => (s ? { ...s, ...sum, events } : s));
      return;
    }
  }
}

// After a stream opened afresh, nothing was replayed: what it would have carried is read again.
function reread(client: QueryClient) {
  client.invalidateQueries({ queryKey: sessionsKey });
  client.invalidateQueries({ queryKey: ["session"] });
  client.invalidateQueries({ queryKey: ["queue"] });
  client.invalidateQueries({ queryKey: approvalsKey });
}

export function StreamProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [link, setLink] = useState<Link>("connecting");
  useEffect(() => {
    const seen = new Map<string, string>();
    const stop = new AbortController();
    const wait = (ms: number) =>
      new Promise<void>((done) => {
        const timer = setTimeout(done, ms);
        stop.signal.addEventListener("abort", () => (clearTimeout(timer), done()));
      });
    (async () => {
      let last: string | undefined;
      let tries = 0;
      let dropped = false;
      let fresh = false;
      while (!stop.signal.aborted) {
        let opened = false;
        try {
          for await (const m of transport().stream("/stream", last, stop.signal)) {
            if (!opened) {
              opened = true;
              tries = 0;
              setLink("open");
              if (fresh) reread(client);
              else if (dropped) client.invalidateQueries({ queryKey: sessionsKey });
              dropped = fresh = false;
            }
            if (m.id) last = m.id;
            if (!m.data) continue;
            let u: Update;
            try {
              u = JSON.parse(m.data) as Update;
            } catch {
              continue;
            }
            apply(client, u, seen);
          }
        } catch (e) {
          if (stop.signal.aborted) return;
          if (e instanceof StreamError) {
            dropped = fresh = true;
            last = undefined;
            setLink("reconnecting");
            // The stream cannot say why it was refused; a plain request does, and a 401 there signs the reader out.
            api.get("/me").catch(() => {});
            await wait(backoff(tries++, 1000, 30_000));
            continue;
          }
        }
        if (stop.signal.aborted) return;
        // Closed or unreachable: opened again from the last id, as the server's retry asks.
        dropped = true;
        setLink("reconnecting");
        await wait(2000);
      }
    })();
    return () => stop.abort();
  }, [client]);
  return <LinkContext.Provider value={link}>{children}</LinkContext.Provider>;
}
