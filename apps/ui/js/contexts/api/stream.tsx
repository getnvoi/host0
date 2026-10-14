import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/contexts/api/client";
import { approvalsKey, changesKey, queueKey, sessionKey, sessionsKey } from "@/contexts/api/sessions";
import type { Event, Session, Summary, Update } from "@/contexts/api/types";
import { backoff } from "@/lib/backoff";

// One stream for the whole app. The browser reconnects by itself and resends the last id it saw, so the plane
// replays what was missed; a reset means it could not, and every query is refetched. A stream the browser gave up on
// (the plane answered other than 200) is opened again here, without an id, so what it holds is read again.
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
    let source: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    let dropped = false;
    let fresh = false;
    let gone = false;
    const connect = () => {
      const s = new EventSource("/api/stream");
      source = s;
      s.onopen = () => {
        tries = 0;
        setLink("open");
        if (fresh) reread(client);
        else if (dropped) client.invalidateQueries({ queryKey: sessionsKey });
        dropped = fresh = false;
      };
      s.onerror = () => {
        dropped = true;
        setLink("reconnecting");
        // Still connecting: the browser retries by itself.
        if (s.readyState !== EventSource.CLOSED || gone) return;
        s.close();
        fresh = true;
        // The stream cannot say why it closed; a plain request does, and a 401 there sends the reader to sign in.
        api.get("/me").catch(() => {});
        timer = setTimeout(connect, backoff(tries++, 1000, 30_000));
      };
      s.onmessage = (e) => {
        let u: Update;
        try {
          u = JSON.parse(e.data) as Update;
        } catch {
          return;
        }
        apply(client, u, seen);
      };
    };
    connect();
    return () => {
      gone = true;
      clearTimeout(timer);
      source?.close();
    };
  }, [client]);
  return <LinkContext.Provider value={link}>{children}</LinkContext.Provider>;
}
