// The hub (`/v1/...`) and, through it, the plane of the workspace in use (`/v1/workspaces/{ws}/plane/...`). Every
// request goes out through the shell's fetch (no CORS) with the device token from the Keychain. README.md is the contract.
import { sse, type Transport } from "@hz/transport";
import * as native from "@/native";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const hub = String(import.meta.env.VITE_HZ_HUB ?? "").replace(/\/$/, "");

let token: string | undefined;
let ws: string | undefined;

export const signed = () => token !== undefined;
export const workspace = () => ws;
export const bearer = () => ({ Authorization: `Bearer ${token ?? ""}` });

// The Keychain entry: service "hz" (src-tauri), account the hub's host.
const account = () => new URL(hub).host;

// Reads the token kept from the last sign-in.
export async function boot() {
  if (!hub) throw new Error("This build names no hub: build it with VITE_HZ_HUB set.");
  token = (await native.keychain.get(account())) ?? undefined;
}

export async function keepToken(next?: string) {
  token = next;
  if (next) await native.keychain.set(account(), next);
  else await native.keychain.delete(account());
}

// The workspace whose plane the app reads, kept on this machine for the next launch.
export function enter(name: string | undefined) {
  ws = name;
  try {
    if (name) localStorage.setItem("hz.workspace", name);
  } catch {
    // Kept when storage allows it.
  }
}

export function remembered() {
  try {
    return localStorage.getItem("hz.workspace") ?? undefined;
  } catch {
    return undefined;
  }
}

const space = () => `${hub}/v1/workspaces/${encodeURIComponent(ws ?? "")}`;
export const planeBase = () => `${space()}/plane`;

// How many times a read is sent before its failure is the answer; writes are sent once.
const ASKS = 4;
const ASK_PAUSE_MS = 1000;
const lost = (status?: number) => status === undefined || status === 502 || status === 503 || status === 504;

async function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { ...bearer(), Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let answer: Response | undefined;
  let failure: unknown;
  for (let ask = 1, pause = ASK_PAUSE_MS; ; ask++, pause *= 2) {
    try {
      answer = await native.fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      failure = undefined;
    } catch (e) {
      answer = undefined;
      failure = e;
    }
    if (method !== "GET" || ask === ASKS || !lost(answer?.status)) break;
    await new Promise((done) => setTimeout(done, pause));
  }
  if (!answer) throw failure instanceof Error ? failure : new Error(String(failure));
  const text = await answer.text();
  // The hub and the plane answer a refusal with a sentence; a proxy's page of HTML is not one.
  if (!answer.ok) throw new ApiError(text.trim() && !/^\s*</.test(text) ? text.trim() : `${method} ${url} answered ${answer.status}.`, answer.status);
  return (text ? JSON.parse(text) : undefined) as T;
}

// A hub route: `workspaces`, `auth/token`.
export const hubRequest = <T>(method: string, path: string, body?: unknown) => send<T>(method, `${hub}/v1/${path}`, body);
// A route of the workspace on the hub: `runs/{id}`, `repositories`.
export const spaceRequest = <T>(method: string, path: string, body?: unknown) => send<T>(method, `${space()}/${path}`, body);
// A plane route, as the plane names it: `sessions`, `llm/configs`.
export const request = <T>(method: string, path: string, body?: unknown) => send<T>(method, `${planeBase()}/${path}`, body);
export const get = <T>(path: string) => request<T>("GET", path);

export const openUrl = (url: string) => native.openURL(url);

// The plane through the hub, for what streams and what opens a socket. Sign-out is the account's (live.tsx).
export const transport: Transport & { signedOut: () => void } = {
  get base() {
    return planeBase();
  },
  headers: bearer,
  fetch: native.fetch,
  stream: (path, lastEventId, signal) => sse(native.fetch, planeBase() + path, bearer(), lastEventId, signal),
  socketURL: async (path) => {
    const { ticket } = await spaceRequest<{ ticket: string }>("POST", "tickets");
    const u = new URL(planeBase() + path);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.searchParams.set("ticket", ticket);
    return u.toString();
  },
  previewURL: (host) => `https://${host}`,
  signedOut: () => {},
};
