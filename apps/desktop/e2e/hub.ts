// The stub hub the e2e tests run the app against: README.md's hub routes, and the plane's behind
// /v1/workspaces/{ws}/plane, answering from e2e/recorded. POST /__scenario resets it ("fresh" or "ready"); GET /__log
// lists the writes it took; POST /__push sends the recorded streamed event on the plane's stream.
import hubRecorded from "./recorded/hub.json";
import planeRecorded from "./recorded/plane.json";

const port = Number(process.env.HUB_PORT ?? 5481);
const TOKEN = "e2e-device-token";

type Env = typeof planeRecorded.proposal;
type Summary = Record<string, unknown>;

let state = fresh();

function fresh() {
  return {
    challenges: new Map<string, string>(),
    codes: new Map<string, string>(),
    workspaces: [] as { name: string; plan: string; location: string; ready: boolean; run: string | null }[],
    configs: [] as { name: string; provider: string; values: Record<string, string>; main: boolean; at: string }[],
    environments: new Map<string, Env>(),
    sessions: new Map<string, typeof planeRecorded.session>(),
    approvals: [] as (typeof planeRecorded.approval)[],
    log: [] as { method: string; path: string; body: unknown }[],
    streams: new Set<ReadableStreamDefaultController<Uint8Array>>(),
    sent: 0,
  };
}

function ready() {
  state = fresh();
  state.workspaces = [{ name: "northwind", plan: "starter", location: "fsn1", ready: true, run: null }];
  state.configs = [{ name: "Claude", provider: "claude_code", values: { kind: "api_key", model: "sonnet" }, main: true, at: "2026-10-15T09:00:00Z" }];
  state.environments.set("shop", planeRecorded.proposal);
  state.sessions.set(planeRecorded.session.id, structuredClone(planeRecorded.session));
  state.approvals = [structuredClone(planeRecorded.approval)];
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Last-Event-ID",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const said = (sentence: string, status: number) => new Response(sentence, { status, headers: { ...cors, "Content-Type": "text/plain" } });
const encoder = new TextEncoder();

function sse(start: (send: (id: string, data: unknown) => void, controller: ReadableStreamDefaultController<Uint8Array>) => void | Promise<void>, keep = false) {
  let own: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      own = controller;
      const send = (id: string, data: unknown) => controller.enqueue(encoder.encode(`id: ${id}\ndata: ${JSON.stringify(data)}\n\n`));
      await start(send, controller);
      if (!keep) controller.close();
    },
    cancel() {
      if (own) state.streams.delete(own);
    },
  });
  return new Response(stream, { headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
}

function broadcast(update: unknown) {
  state.sent++;
  for (const c of state.streams) {
    try {
      c.enqueue(encoder.encode(`id: ${state.sent}\ndata: ${JSON.stringify(update)}\n\n`));
    } catch {
      state.streams.delete(c);
    }
  }
}

const summaryOf = (s: typeof planeRecorded.session): Summary => ({
  id: s.id, env: s.env, branch: s.branch, preview: s.preview, state: s.state, title: s.title,
  prompt: s.events.find((e) => e.kind === "prompt")?.content ?? "", queued: 0, at: s.at, last: s.last,
});

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function s256(verifier: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier)));
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function plane(method: string, route: string, url: URL, body: unknown): Promise<Response> {
  const parts = route.split("/").filter(Boolean);
  const env = (name: string) => state.environments.get(decodeURIComponent(name));
  switch (`${method} ${parts[0]}${parts.length > 1 ? "/" + (parts.length === 2 ? "*" : `*/${parts.slice(2).join("/")}`) : ""}`) {
    case "GET me":
      return json(planeRecorded.me);
    case "GET stream":
      return sse((_, controller) => void state.streams.add(controller), true);
    case "GET llm/*":
      if (parts[1] === "providers") return json(planeRecorded.providers);
      return json(state.configs);
    case "POST llm/*": {
      const c = body as { name: string; provider: string; values: Record<string, string> };
      if (state.configs.some((x) => x.name === c.name)) return said(`Another credential is called ${c.name}. Pick another label.`, 409);
      const made = { ...c, main: state.configs.length === 0, at: new Date().toISOString() };
      state.configs.push(made);
      return json({ ...made, values: { kind: c.values.kind }, stored: ["token"] });
    }
    case "GET cluster/*":
      return json(planeRecorded.shape);
    case "GET environments":
      return json([...state.environments.values()].map((e) => ({ name: e.name, repo: e.repo, branch: e.branch, tier: e.tier, ready: true })));
    case "POST environments/*":
      if (parts[1] === "propose") return json({ ...planeRecorded.proposal, repo: (body as { repo: string }).repo });
      return said("no such route", 404);
    case "PUT environments/*":
      state.environments.set(decodeURIComponent(parts[1]), body as Env);
      return new Response(null, { status: 204, headers: cors });
    case "GET environments/*":
      return env(parts[1]) ? json(env(parts[1])) : said(`environment ${parts[1]} not found`, 404);
    case "POST environments/*/seed":
      void (async () => {
        for (const seed of planeRecorded.seed) {
          await wait(seed.state === "ready" ? 1500 : 300);
          broadcast({ kind: "seed", seed });
        }
      })();
      return new Response(null, { status: 202, headers: cors });
    case "GET environments/*/seed":
      return json({ env: parts[1], state: "building", step: "starting", at: new Date().toISOString() });
    case "GET sessions":
      return json([...state.sessions.values()].map(summaryOf));
    case "POST sessions": {
      const b = body as { env: string; prompt: string };
      const s = { ...structuredClone(planeRecorded.session), id: `s${state.sessions.size + 1}`, env: b.env, state: "forking", title: "", events: b.prompt ? [{ kind: "prompt", content: b.prompt, at: new Date().toISOString() }] : [] };
      s.branch = `hz/${s.id}`;
      s.preview = `${s.id}.northwind.example.com`;
      state.sessions.set(s.id, s);
      return json(s);
    }
    case "GET sessions/*":
      return state.sessions.has(parts[1]) ? json(state.sessions.get(parts[1])) : said(`session ${parts[1]} not found`, 404);
    case "GET sessions/*/queue":
      return json([]);
    case "GET sessions/*/preview":
      return json({ up: false });
    case "GET sessions/*/terminals":
      return json([]);
    case "GET approvals": {
      const session = url.searchParams.get("session");
      return json(state.approvals.filter((a) => a.state === "pending" && (!session || a.session === session)));
    }
    case "POST approvals/*/approve":
    case "POST approvals/*/deny": {
      const a = state.approvals.find((x) => x.id === parts[1]);
      if (!a) return said(`approval ${parts[1]} not found`, 404);
      a.state = parts[2] === "approve" ? "approved" : "denied";
      broadcast({ kind: "approval", approval: a });
      return json(a, 202);
    }
  }
  return said(`the stub plane has no ${method} ${route}`, 404);
}

Bun.serve({
  port,
  hostname: "127.0.0.1",
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const method = req.method;
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const text = method === "GET" || method === "HEAD" ? "" : await req.text();
    const body = text ? JSON.parse(text) : undefined;
    const path = url.pathname;
    if (path === "/__scenario") {
      (body as { name: string }).name === "ready" ? ready() : (state = fresh());
      return json({ ok: true });
    }
    if (path === "/__log") return json(state.log);
    if (path === "/__push") {
      const s = state.sessions.get(planeRecorded.session.id)!;
      const from = s.events.length;
      s.events.push(planeRecorded.streamed);
      s.last = planeRecorded.streamed.at;
      broadcast({ kind: "session", session: summaryOf(s), from, events: [planeRecorded.streamed] });
      return json({ ok: true });
    }
    if (method !== "GET") state.log.push({ method, path, body });

    // Signing in: the browser's leg, then the app's exchange.
    if (method === "GET" && path === "/v1/auth/github") {
      const code = `code-${Math.random().toString(36).slice(2, 8)}`;
      state.challenges.set(code, url.searchParams.get("challenge") ?? "");
      return new Response(null, { status: 302, headers: { ...cors, Location: `${url.searchParams.get("redirect")}?code=${code}&state=${url.searchParams.get("state")}` } });
    }
    if (method === "POST" && path === "/v1/auth/token") {
      const { code, verifier } = body as { code: string; verifier: string };
      const challenge = state.challenges.get(code);
      state.challenges.delete(code);
      if (!challenge || challenge !== (await s256(verifier))) return said("This code was used, or it is not this app's.", 400);
      return json({ token: TOKEN });
    }
    if (req.headers.get("Authorization") !== `Bearer ${TOKEN}`) return said("Sign in again.", 401);
    if (method === "DELETE" && path === "/v1/auth/token") return new Response(null, { status: 204, headers: cors });
    if (method === "GET" && path === "/v1/me") return json(hubRecorded.me);
    if (method === "GET" && path === "/v1/offer") return json(hubRecorded.offer);
    if (method === "GET" && path === "/v1/workspaces") return json(state.workspaces);
    if (method === "POST" && path === "/v1/workspaces") {
      const w = body as { name: string; plan: string; location: string };
      if (state.workspaces.some((x) => x.name === w.name)) return said(`A workspace is called ${w.name} already.`, 409);
      const made = { ...w, ready: false, run: "r1" };
      state.workspaces.push(made);
      return json(made, 201);
    }
    const m = path.match(/^\/v1\/workspaces\/([^/]+)\/(.*)$/);
    if (!m) return said(`the stub hub has no ${method} ${path}`, 404);
    const ws = state.workspaces.find((w) => w.name === decodeURIComponent(m[1]));
    if (!ws) return said(`no workspace ${m[1]}`, 404);
    const rest = m[2];
    if (method === "POST" && rest === "runs") {
      ws.run = `r${Date.now()}`;
      return json({ id: ws.run }, 201);
    }
    const run = rest.match(/^runs\/([^/]+)\/stream$/);
    if (method === "GET" && run) {
      const from = Number(url.searchParams.get("from") ?? 0);
      return sse(async (send) => {
        const lines = hubRecorded.run;
        for (let i = from; i < lines.length; i++) {
          await wait(150);
          send(String(i), i === lines.length - 1 ? { line: lines[i], state: "ok" } : { line: lines[i] });
        }
        ws.ready = true;
        ws.run = null;
      });
    }
    if (method === "GET" && rest === "repositories") return json(hubRecorded.repositories);
    if (method === "GET" && rest === "usage") return json(hubRecorded.usage);
    if (method === "POST" && rest === "tickets") return json({ ticket: "e2e-ticket" });
    if (rest.startsWith("plane/")) {
      if (!ws.ready) return said(`workspace ${ws.name} is not ready`, 503);
      return plane(method, rest.slice("plane/".length), url, body);
    }
    return said(`the stub hub has no ${method} ${path}`, 404);
  },
});

console.log(`stub hub on http://127.0.0.1:${port}`);
