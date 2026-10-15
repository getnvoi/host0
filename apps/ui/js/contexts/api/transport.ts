// Where the app's requests go and how they are signed: the browser build talks to the plane that served it with its
// cookie, the desktop build to a hub with a bearer token. Nothing else differs between the two.
export type Message = { id: string; data: string };

export interface Transport {
  base: string;
  headers(): Record<string, string>;
  // Set when requests must not go through the page's own fetch (the desktop's, which no CORS rule applies to).
  fetch?: typeof fetch;
  stream(path: string, lastEventId?: string, signal?: AbortSignal): AsyncIterable<Message>;
  socketURL(path: string): Promise<string>;
  previewURL(host: string): string;
  signedOut(): void;
}

// A stream the server answered other than 200: the browser's EventSource gives up on it, and so does this.
export class StreamError extends Error {
  constructor(readonly status: number) {
    super(`stream answered ${status}`);
  }
}

// Server-sent events over fetch, which can carry Authorization where EventSource cannot. Yields every block that
// holds an id or data; ends when the server closes.
export async function* sse(
  fetcher: typeof fetch,
  url: string,
  headers: Record<string, string>,
  lastEventId?: string,
  signal?: AbortSignal,
): AsyncIterable<Message> {
  const h: Record<string, string> = { ...headers, Accept: "text/event-stream" };
  if (lastEventId) h["Last-Event-ID"] = lastEventId;
  const res = await fetcher(url, { headers: h, signal, cache: "no-store" });
  if (res.status !== 200 || !res.body) throw new StreamError(res.status);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  let id = "";
  let data: string[] = [];
  let seen = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += value;
    let nl: number;
    while ((nl = buf.search(/\r\n|\r|\n/)) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + (buf.startsWith("\r\n", nl) ? 2 : 1));
      if (line === "") {
        if (seen) yield { id, data: data.join("\n") };
        id = "";
        data = [];
        seen = false;
        continue;
      }
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      const v = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "id") {
        id = v;
        seen = true;
      } else if (field === "data") {
        data.push(v);
        seen = true;
      }
    }
  }
}

// The plane that served this page, signed in by its cookie. A write carries X-Requested-With, which the plane
// requires of a browser: no cross-site form can set it.
export const browser: Transport = {
  base: "/api",
  headers: () => ({ "X-Requested-With": "h0" }),
  stream: (path, lastEventId, signal) => sse(fetch, `/api${path}`, {}, lastEventId, signal),
  socketURL: async (path) => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api${path}`,
  // Served as this page is: https on a cluster, http on a port for a local one.
  previewURL: (host) => `${location.protocol}//${host}${location.port ? `:${location.port}` : ""}`,
  signedOut: () => {
    if (location.pathname !== "/login") location.assign("/login");
  },
};

let current: Transport = browser;

export const transport = () => current;

export function setTransport(t: Transport) {
  current = t;
}
