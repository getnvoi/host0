// Who is signed in, the cache of GET answers, and the plane's stream that says which of them changed. Nothing is read
// on a timer: an update names what moved and the answers under it are fetched again.
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StreamError } from "@hz/transport";
import { ApiError, boot, enter, get, hubRequest, keepToken, remembered, signed, transport, workspace } from "./client";
import type { EnvironmentSummary, Update, User, Workspace } from "./models";

export type Me = { user: User; workspaces: Workspace[]; workspace?: Workspace };

// An answer younger than this is not asked again; an older one shows at once and is fetched behind it.
export const fresh = 15_000;

export const queries = new QueryClient({
  defaultOptions: { queries: { staleTime: fresh, gcTime: 3600_000, retry: false, refetchOnWindowFocus: false } },
});

// A plane GET, cached under its path.
export function useApi<T>(path: string | undefined) {
  return useQuery({ queryKey: ["api", path], queryFn: () => get<T>(path!), enabled: !!path });
}

// A hub GET, cached under its path.
export function useHub<T>(path: string | undefined) {
  return useQuery({ queryKey: ["hub", path], queryFn: () => hubRequest<T>("GET", path!), enabled: !!path });
}

// A write; every plane answer goes stale after it, as the plane may have changed any of them.
export function useWrite<T, V = void>(write: (vars: V) => Promise<T>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: write, onSuccess: () => client.invalidateQueries({ queryKey: ["api"] }) });
}

// Marks the plane answers under <topic> stale, or all of them.
export function stale(topic?: string) {
  return queries.invalidateQueries({
    predicate: (q) => q.queryKey[0] === "api" && (!topic || String(q.queryKey[1] ?? "").startsWith(topic)),
  });
}

// Pages that read the stream themselves (the seed's log) hear every update.
const heard = new Set<(u: Update) => void>();
export function useUpdates(listener: (u: Update) => void) {
  useEffect(() => {
    heard.add(listener);
    return () => void heard.delete(listener);
  }, [listener]);
}

function apply(u: Update) {
  switch (u.kind) {
    case "reset":
      return void stale();
    case "approval":
      void stale("approvals");
      return void stale(`sessions/${u.approval.session}`);
    case "seed":
      return void stale("environments");
    case "session":
      void stale(`sessions/${u.session.id}`);
      void stale("sessions?");
      return void queries.invalidateQueries({ queryKey: ["api", "sessions"], exact: true });
  }
}

// The stream's link, for the composer's reconnecting line.
let reconnecting = false;
const linkListeners = new Set<() => void>();
const setReconnecting = (r: boolean) => {
  if (r === reconnecting) return;
  reconnecting = r;
  linkListeners.forEach((l) => l());
};
export function useReconnecting() {
  return useSyncExternalStore(
    (l) => (linkListeners.add(l), () => void linkListeners.delete(l)),
    () => reconnecting,
  );
}

// Follows the plane's stream until `signal` aborts: from the last id after a drop, so the plane replays what was
// missed; afresh after a refusal, with every answer read again. Four refusals in a row end it with the reason.
async function follow(signal: AbortSignal, failed: (why: string) => void) {
  const wait = (ms: number) =>
    new Promise<void>((done) => {
      const timer = setTimeout(done, ms);
      signal.addEventListener("abort", () => (clearTimeout(timer), done()));
    });
  let last: string | undefined;
  let refused = 0;
  while (!signal.aborted) {
    try {
      for await (const m of transport.stream("/stream", last, signal)) {
        refused = 0;
        setReconnecting(false);
        if (m.id) last = m.id;
        if (!m.data) continue;
        let u: Update;
        try {
          u = JSON.parse(m.data) as Update;
        } catch {
          continue;
        }
        apply(u);
        heard.forEach((l) => l(u));
      }
    } catch (e) {
      if (signal.aborted) return;
      if (e instanceof StreamError) {
        if (++refused >= 4) return failed(`The workspace's stream answered ${e.status} four times.`);
        last = undefined;
        void stale();
      }
    }
    if (signal.aborted) return;
    setReconnecting(true);
    await wait(2000 * Math.max(1, refused));
  }
}

type Account = {
  ready: boolean;
  // While the hub cannot be reached at launch: why, and when the next try runs.
  unreachable?: { message: string; next: number };
  retry: () => void;
  me?: Me;
  // The workspace in use is set up: it answers and holds an environment. False: onboarding shows.
  onboarded?: boolean;
  adopt: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  // Opens the app on another workspace, or on a new one once it is made.
  switchTo: (name: string) => Promise<void>;
  // Opens the app on a workspace whose onboarding is not finished.
  enter: () => void;
};

const AccountContext = createContext<Account | undefined>(undefined);

export function useAccount() {
  const account = useContext(AccountContext);
  if (!account) throw new Error("useAccount outside LiveProvider");
  return account;
}

function useAccountState(): Account {
  const [ready, setReady] = useState(false);
  const [unreachable, setUnreachable] = useState<{ message: string; next: number }>();
  const [attempt, setAttempt] = useState(0);
  const [me, setMe] = useState<Me>();
  const [onboarded, setOnboarded] = useState<boolean>();
  const [following, setFollowing] = useState<string>();

  const refresh = async () => {
    const [user, workspaces] = await Promise.all([hubRequest<User>("GET", "me"), hubRequest<Workspace[]>("GET", "workspaces")]);
    const current = workspaces.find((w) => w.name === (workspace() ?? remembered())) ?? workspaces[0];
    enter(current?.name);
    let done = false;
    if (current?.ready) done = (await get<EnvironmentSummary[]>("environments")).length > 0;
    setOnboarded((was) => (was === true && current?.ready ? true : done));
    setFollowing(current?.ready ? current.name : undefined);
    setMe({ user, workspaces, workspace: current });
  };

  const drop = async () => {
    queries.clear();
    await keepToken(undefined);
    setFollowing(undefined);
    setMe(undefined);
    setOnboarded(undefined);
  };

  const logout = async () => {
    await hubRequest("DELETE", "auth/token").catch(() => undefined);
    await drop();
  };
  transport.signedOut = () => void drop();

  // The stream of the workspace in use, while it answers.
  useEffect(() => {
    if (!following) return;
    const stop = new AbortController();
    void follow(stop.signal, (why) => setUnreachable({ message: why, next: Date.now() }));
    return () => stop.abort();
  }, [following]);

  // Only the hub refusing the token signs out; a failed request (offline, a reload mid-flight) tries again.
  useEffect(() => {
    let stopped = false;
    let wait = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = async () => {
      try {
        await boot();
        if (signed()) await refresh();
        if (stopped) return;
        setUnreachable(undefined);
        setReady(true);
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          await drop();
          if (!stopped) setReady(true);
          return;
        }
        if (stopped) return;
        setUnreachable({ message: error instanceof Error ? error.message : String(error), next: Date.now() + wait });
        timer = setTimeout(start, wait);
        wait = Math.min(wait * 2, 30_000);
      }
    };
    void start();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [attempt]);

  return {
    ready,
    unreachable,
    retry: () => setAttempt((n) => n + 1),
    me,
    onboarded,
    refresh,
    adopt: async (token) => {
      queries.clear();
      await keepToken(token);
      await refresh();
    },
    logout,
    switchTo: async (name) => {
      queries.clear();
      enter(name);
      setOnboarded(undefined);
      await refresh();
    },
    enter: () => setOnboarded(true),
  };
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const account = useAccountState();
  return (
    <QueryClientProvider client={queries}>
      <AccountContext.Provider value={account}>{children}</AccountContext.Provider>
    </QueryClientProvider>
  );
}
