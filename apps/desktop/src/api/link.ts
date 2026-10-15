// h0:// links, which the hub's GitHub callback sends the browser back with: `h0://auth?code=<code>&state=<state>`, or
// `?error=<reason>&state=<state>` when GitHub refused. A return wakes the sign-in waiting on its state.
import * as native from "@/native";

export type Return = { code?: string; error?: string };

const returns = new Map<string, Return>();
const waiting = new Set<() => void>();

export const returnFor = (state: string) => returns.get(state);

// Resolves when a return arrives, or after `ms`.
export function returnOr(ms: number) {
  return new Promise<void>((done) => {
    const wake = () => {
      clearTimeout(timer);
      waiting.delete(wake);
      done();
    };
    const timer = setTimeout(wake, ms);
    waiting.add(wake);
  });
}

function opened(address: string) {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return;
  }
  if (url.protocol !== "h0:" || url.host !== "auth") return;
  const state = url.searchParams.get("state");
  if (!state) return;
  returns.set(state, { code: url.searchParams.get("code") ?? undefined, error: url.searchParams.get("error_description") ?? url.searchParams.get("error") ?? undefined });
  for (const wake of [...waiting]) wake();
  native.focus();
}

// Once per page: a hot reload runs the entry again.
let listening: Promise<unknown> | undefined;
export function listenForLinks() {
  listening ??= native.onDeepLink(opened);
  return listening;
}
