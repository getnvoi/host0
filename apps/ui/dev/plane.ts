// A stand-in plane for working on the UI without a cluster: fixtures for the API, a local shell for terminals.
// bun dev/plane.ts, then HZ_APP=http://127.0.0.1:5445 bun run dev.
import type { ServerWebSocket, Subprocess } from "bun";

const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const PR = '{"title":"Add /health","body":"Adds GET /health, rendering the plain text ok, with a controller test."}';

const events = [
  { kind: "prompt", content: "Add a /health route that renders the plain text “ok”, with a controller test. Run the test, commit, then open a pull request titled “Add /health”.", at: ago(4) },
  { kind: "message", content: "I'll look at the routes and controllers first.", at: ago(4) },
  { kind: "tool_use", tool: "Bash", tool_id: "t1", content: '{"command":"cat config/routes.rb && ls app/controllers"}', at: ago(4) },
  { kind: "tool_result", tool_id: "t1", content: 'Rails.application.routes.draw do\n  get "up" => "rails/health#show"\n  root "logs#index"\nend\napplication_controller.rb\nlogs_controller.rb', at: ago(4) },
  { kind: "tool_use", tool: "Task", tool_id: "s1", content: '{"description":"review-tests","subagent_type":"general-purpose","prompt":"Read test/controllers and say how controller tests are written here."}', at: ago(4) },
  { kind: "message", parent: "s1", content: "Reading the controller tests.", at: ago(4) },
  { kind: "tool_use", parent: "s1", tool: "Read", tool_id: "r1", content: '{"file_path":"test/controllers/logs_controller_test.rb"}', at: ago(4) },
  { kind: "tool_result", parent: "s1", tool_id: "r1", content: "class LogsControllerTest < ActionDispatch::IntegrationTest\n  test \"index\" do\n    get root_url\n    assert_response :success\n  end\nend", at: ago(4) },
  { kind: "message", parent: "s1", content: "Integration tests with `ActionDispatch::IntegrationTest`, one file per controller.", at: ago(4) },
  { kind: "task", tool_id: "s1", content: '{"state":"notification","status":"completed","summary":"Integration tests, one file per controller.","tokens":18500,"tools":5,"duration_ms":12300}', at: ago(3) },
  { kind: "tool_result", tool_id: "s1", content: "Integration tests, one file per controller.\nagentId: a7f3c2", at: ago(3) },
  { kind: "tool_use", tool: "Write", tool_id: "t2", content: '{"file_path":"app/controllers/health_controller.rb"}', at: ago(3) },
  { kind: "tool_result", tool_id: "t2", content: "File created", at: ago(3) },
  { kind: "tool_use", tool: "Edit", tool_id: "t3", content: '{"file_path":"config/routes.rb"}', at: ago(3) },
  { kind: "tool_result", tool_id: "t3", content: "Edited", at: ago(3) },
  { kind: "tool_use", tool: "Bash", tool_id: "t4", content: '{"command":"bin/rails test test/controllers/health_controller_test.rb"}', at: ago(3) },
  { kind: "tool_result", tool_id: "t4", content: "1 runs, 3 assertions, 0 failures, 0 errors, 0 skips", at: ago(3) },
  { kind: "tool_use", tool: "Bash", tool_id: "t5", content: '{"command":"git add -A && git commit -m \\"Add /health route rendering plain text ok\\""}', at: ago(3) },
  { kind: "tool_result", tool_id: "t5", content: "[hz/4ca708e1 5b608cc] Add /health route rendering plain text ok", at: ago(3) },
  { kind: "message", content: "Added `HealthController#show` and the route. The controller test passes (1 run, 3 assertions), and the change is committed on `hz/4ca708e1`. I asked to open the pull request.", at: ago(2) },
  { kind: "tool_use", tool: "mcp__hz__create_pull_request", tool_id: "p1", content: PR, at: ago(2) },
  { kind: "tool_result", tool_id: "p1", content: "Queued.", at: ago(2) },
  { kind: "result", content: "done", meta: { duration_ms: 38200, tokens: 21400 }, at: ago(2) },
];

const providers = [
  { key: "claude_code", label: "Claude Code", fields: [
    { key: "kind", label: "Credential kind", type: "select", required: true, help: "oauth for a Claude subscription, api_key for an Anthropic key, bearer for a third-party endpoint such as z.ai or Kimi",
      options: [{ value: "oauth", label: "Claude subscription (OAuth)" }, { value: "api_key", label: "Anthropic API key" }, { value: "bearer", label: "Third-party endpoint (bearer)" }] },
    { key: "token", label: "Token", type: "password", required: true, secret: true, placeholder: "sk-ant-..." },
    { key: "base_url", label: "Base URL", type: "text", placeholder: "https://api.anthropic.com", help: "Only for a third-party endpoint. Leave empty for Anthropic." },
    { key: "model", label: "Model", type: "select", default: "sonnet", help: "The vendor's alias; it follows their current model.",
      options: [{ value: "sonnet", label: "Sonnet" }, { value: "opus", label: "Opus" }, { value: "haiku", label: "Haiku" }] },
  ] },
  { key: "codex", label: "Codex", fields: [
    { key: "kind", label: "Credential kind", type: "select", required: true, help: "chatgpt for a ChatGPT sign-in, api_key for an OpenAI key",
      options: [{ value: "chatgpt", label: "ChatGPT sign-in" }, { value: "api_key", label: "OpenAI API key" }] },
    { key: "token", label: "Token", type: "password", required: true, secret: true, placeholder: "sk-...", help: "For a ChatGPT sign-in, the whole of ~/.codex/auth.json." },
    { key: "base_url", label: "Base URL", type: "text", placeholder: "https://api.openai.com/v1", help: "Only for an OpenAI-compatible endpoint. Leave empty for OpenAI." },
    { key: "model", label: "Model", type: "text", placeholder: "gpt-5", help: "Empty runs codex's default." },
  ] },
];

type Config = { name: string; provider: string; values: Record<string, string>; stored: string[]; main: boolean; archived_at?: string; at: string };
const configs: Config[] = [
  { name: "Claude Code", provider: "claude_code", values: { kind: "oauth", model: "sonnet" }, stored: ["token"], main: true, at: ago(600) },
  { name: "Codex", provider: "codex", values: { kind: "chatgpt" }, stored: ["token"], main: false, at: ago(60) },
];

// The plane's rules for which credential is in use, enough to click through the pages.
function handOver() {
  if (!configs.some((c) => c.main && !c.archived_at)) {
    const first = configs.find((c) => !c.archived_at);
    if (first) first.main = true;
  }
}

async function llm(req: Request, path: string): Promise<Response> {
  if (path === "/llm/providers") return json(providers);
  if (path === "/llm/configs" && req.method === "GET") return json(configs);
  if (path === "/llm/configs" && req.method === "POST") {
    const c = await req.json();
    if (configs.some((o) => o.name === c.name)) return new Response(`Another credential is called ${c.name}. Pick another label.`, { status: 409 });
    if (!c.values.token) return new Response("Token is needed", { status: 400 });
    const { token, ...values } = c.values;
    configs.push({ name: c.name, provider: c.provider, values, stored: ["token"], main: false, at: new Date().toISOString() });
    handOver();
    return json(configs.at(-1));
  }
  const m = path.match(/^\/llm\/configs\/([^/]+)(\/main|\/restore)?$/);
  const c = m && configs.find((o) => o.name === decodeURIComponent(m[1]));
  if (!m || !c) return new Response("not found", { status: 404 });
  if (req.method === "PUT") {
    const { token, ...values } = (await req.json()).values;
    c.values = values;
    return json(c);
  }
  if (m[2] === "/main") configs.forEach((o) => (o.main = o === c));
  else if (m[2] === "/restore") delete c.archived_at;
  else if (new URL(req.url).searchParams.get("remove")) configs.splice(configs.indexOf(c), 1);
  else Object.assign(c, { archived_at: new Date().toISOString(), main: false });
  handOver();
  return new Response(null, { status: 204 });
}

const summaries = [
  { id: "4ca708e1", env: "dummy-rails", title: "Add /health route", state: "awaiting_approval", last: ago(1), queued: 0 },
  { id: "01a0ce80", env: "dummy-rails", title: "Survey codebase with 4 parallel agents", state: "running", last: ago(12), queued: 1 },
  { id: "9b1e44d2", env: "dummy-rails", title: "Note production check in README", state: "idle", last: ago(180), queued: 0 },
  { id: "5d0f7a13", env: "dummy-rails", title: "Check README and home page title", state: "idle", last: ago(60 * 26), queued: 0 },
  { id: "c3aa9f61", env: "dummy-rails", title: "Upgrade to Rails 8.1", state: "failed", error: "bundle install failed: nokogiri needs libxml2", last: ago(60 * 30), queued: 0 },
].map((s) => ({ ...s, branch: `hz/${s.id}`, preview: `${s.id}-dev-preview.nvoi.to`, prompt: s.title, at: s.last }));

const session = (id: string) => {
  const s = summaries.find((x) => x.id === id);
  if (!s) return undefined;
  const own = id === "4ca708e1" ? events : [{ kind: "prompt", content: s.title, at: s.at }, { kind: "message", content: "Working on it.", at: s.at }];
  return { ...s, events: own, turns: 1, actor: `wt-${id}`, claude: "x", mark: 0 };
};

const patch = `diff --git a/app/controllers/health_controller.rb b/app/controllers/health_controller.rb
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/app/controllers/health_controller.rb
@@ -0,0 +1,7 @@
+class HealthController < ApplicationController
+  allow_unauthenticated_access
+
+  def show
+    render plain: "ok"
+  end
+end
diff --git a/config/routes.rb b/config/routes.rb
index 1111111..2222222 100644
--- a/config/routes.rb
+++ b/config/routes.rb
@@ -1,4 +1,5 @@ Rails.application.routes.draw do
 Rails.application.routes.draw do
   get "up" => "rails/health#show", as: :rails_health_check
+  get "health" => "health#show"
   root "logs#index"
 end
diff --git a/test/controllers/health_controller_test.rb b/test/controllers/health_controller_test.rb
new file mode 100644
--- /dev/null
+++ b/test/controllers/health_controller_test.rb
@@ -0,0 +1,8 @@
+require "test_helper"
+
+class HealthControllerTest < ActionDispatch::IntegrationTest
+  test "renders ok" do
+    get "/health"
+    assert_response :success
+    assert_equal "ok", response.body
+  end
+end
`;

const changes = {
  base: "origin/main",
  at: new Date().toISOString(),
  added: 16,
  removed: 0,
  files: [
    { path: "app/controllers/health_controller.rb", status: "added", added: 7, removed: 0 },
    { path: "config/routes.rb", status: "modified", added: 1, removed: 0 },
    { path: "test/controllers/health_controller_test.rb", status: "added", added: 8, removed: 0 },
  ],
  patch,
};

const setup = [
  "Cloning into '/workspace/app'...",
  "Installing Claude Code...",
  "bundle install",
  "Bundle complete! 24 Gemfile dependencies, 96 gems now installed.",
  "bin/rails db:prepare",
  "Created database 'app_development'",
  "",
].join("\n");

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

type Tty = { proc: Subprocess<"pipe", "pipe", "inherit">; scroll: string; clients: Set<ServerWebSocket<Data>>; started: string };
type Data = { id: string };
const ttys = new Map<string, Tty>();

function tty(id: string): Tty {
  let t = ttys.get(id);
  if (t) return t;
  const proc = Bun.spawn(["python3", "-c", "import pty; pty.spawn(['bash', '-l'])"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    env: { ...process.env, TERM: "xterm-256color" },
    cwd: process.env.HOME,
  });
  t = { proc, scroll: "", clients: new Set(), started: new Date().toISOString() };
  ttys.set(id, t);
  const own = t;
  (async () => {
    for await (const chunk of proc.stdout) {
      const text = new TextDecoder().decode(chunk);
      own.scroll = (own.scroll + text).slice(-256 * 1024);
      for (const c of own.clients) c.send(chunk);
    }
    const code = await proc.exited;
    for (const c of own.clients) {
      c.send(JSON.stringify({ type: "exit", code }));
      c.close(1000);
    }
    ttys.delete(id);
  })();
  return t;
}

Bun.serve<Data, never>({
  port: 5445,
  hostname: "127.0.0.1",
  fetch(req, server) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api/, "");
    let m: RegExpMatchArray | null;
    if (path.startsWith("/llm/")) return llm(req, path);
    if (path === "/me") return json({ cluster: "dev", zone: "nvoi.to" });
    if (path === "/stream") return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("id: 1\nretry: 2000\n\n")); } }), { headers: { "content-type": "text/event-stream" } });
    if (path === "/sessions") return json(summaries);
    if (path === "/environments") return json([{ name: "dummy-rails", repo: "benbonnet/dummy-rails", branch: "main", tier: "medium", ready: true }]);
    if (path === "/approvals") return json([{ id: "a1", session: "4ca708e1", tool: "create_pull_request", input: PR, state: "pending" }]);
    if (path === "/usage") {
      const n = Number(url.searchParams.get("days") ?? 30);
      const days = Array.from({ length: n }, (_, i) => {
        const d = new Date(Date.now() - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10);
        const w = 1 + Math.sin(i / 3) * 0.6 + i / n;
        const running = Math.round(60 * w);
        return {
          day: d,
          compute: { dummy: Math.round(running * 0.7), docs: Math.round(running * 0.3) },
          states: { running, paused: Math.round(90 * w), suspended: Math.round(400 * w) },
          sessions: Math.round(3 * w),
          pull_requests: Math.round(w),
          tokens: Math.round(90_000 * w),
          nodes: Math.round(180 * w),
        };
      });
      const sum = (f: (d: (typeof days)[number]) => number) => days.reduce((a, d) => a + f(d), 0);
      return json({
        from: days[0].day,
        to: days[days.length - 1].day,
        people: ["ana@example.com", "ben@example.com", "cli"],
        totals: { sessions: sum((d) => d.sessions), compute_minutes: sum((d) => d.states.running), pull_requests: sum((d) => d.pull_requests), tokens: sum((d) => d.tokens), approvals: 9, approval_wait_ms: 138_000 },
        days,
        environments: [
          { name: "dummy", compute_minutes: sum((d) => d.compute.dummy), sessions: 40, pull_requests: 12, tokens: 1_800_000 },
          { name: "docs", compute_minutes: sum((d) => d.compute.docs), sessions: 11, pull_requests: 3, tokens: 400_000 },
        ],
      });
    }
    if (path === "/previews") return json({ url: "https://example.com" });
    if ((m = path.match(/^\/sessions\/(\w+)$/))) return session(m[1]) ? json(session(m[1])) : new Response("not found", { status: 404 });
    if ((m = path.match(/^\/sessions\/(\w+)\/queue$/))) return json(m[1] === "01a0ce80" ? ["Also run the linter."] : []);
    if ((m = path.match(/^\/sessions\/(\w+)\/changes$/))) return json(m[1] === "4ca708e1" ? changes : { ...changes, files: [], patch: "", added: 0 });
    if ((m = path.match(/^\/sessions\/(\w+)\/logs$/))) return json([{ name: "setup", kind: "setup" }, { name: "app", kind: "service" }, { name: "jobs", kind: "service" }]);
    if ((m = path.match(/^\/sessions\/(\w+)\/logs\/(\w+)$/))) {
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const body = m[2] === "setup" ? setup : `${m[2]}: Listening on http://0.0.0.0:3000\n`;
      const rest = body.slice(offset);
      return new Response(rest, { headers: { "x-offset": String(offset + rest.length) } });
    }
    if ((m = path.match(/^\/sessions\/(\w+)\/terminals$/)))
      return json([...ttys.entries()].map(([id, t]) => ({ id, command: "bash -l", started: t.started, clients: t.clients.size })));
    if ((m = path.match(/^\/sessions\/(\w+)\/terminals\/([\w-]+)$/))) {
      if (req.method === "DELETE") {
        ttys.get(m[2])?.proc.kill();
        return new Response(null, { status: 204 });
      }
      if (server.upgrade(req, { data: { id: m[2] } })) return;
      return new Response("websocket expected", { status: 400 });
    }
    if (req.method !== "GET") return new Response(null, { status: 204 });
    return new Response("not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      const t = tty(ws.data.id);
      t.clients.add(ws);
      ws.send(new TextEncoder().encode(t.scroll));
    },
    message(ws, msg) {
      const t = ttys.get(ws.data.id);
      if (!t || typeof msg === "string") return;
      t.proc.stdin.write(msg);
      t.proc.stdin.flush();
    },
    close(ws) {
      ttys.get(ws.data.id)?.clients.delete(ws);
    },
  },
});

console.log("mock plane on http://127.0.0.1:5445");
