import type { SetupRecord } from "@h0/ui";

// What the app remembers on this machine between launches so that a person is not asked twice: per workspace, the
// setup of their last session (its agent, environment and repositories). Reads never throw: without storage nothing
// is remembered.

type Store = Pick<Storage, "getItem" | "setItem">;
const here = (): Store | undefined => {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

function read<T>(store: Store | undefined, key: string): Partial<T> {
  try {
    const raw = store?.getItem(key);
    const value = raw ? JSON.parse(raw) : undefined;
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function write(store: Store | undefined, key: string, value: unknown) {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked storage: the choice is simply not kept.
  }
}

const lastKey = (workspace: string) => `h0.last ${workspace}`;

const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

// The setup (ids) of the person's last session in the workspace; none when nothing was kept.
export function lastSetup(workspace: string, store = here()): SetupRecord | undefined {
  const l = read<Record<string, unknown>>(store, lastKey(workspace));
  if (typeof l.agent !== "string" || typeof l.environment !== "string") return undefined;
  return { agent: l.agent, environment: l.environment, repositories: ids(l.repositories) };
}

// A session started: its setup remembered for the next dialog.
export function started(workspace: string, setup: SetupRecord, store = here()) {
  write(store, lastKey(workspace), setup);
}
