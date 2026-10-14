// Fixtures for the gallery, shaped on the API's examples and resources: `GET /sessions`, `/repos`, `/agents`,
// `/sessions/{id}/messages`, `/notes`, `/changes`, `/logs`, `/inbox`.
import type { CommanderGroup } from "../../commander";
import type { TerminalLine } from "../../conversation";
import type {
  AgentRecord, AuthorRecord, ChangesRecord, EventRecord, FileRecord, FilesRecord, LogsRecord, NoteRecord, PullRequestRecord, RepoRecord, SessionDetail,
  SessionRecord, TurnRecord, WorktreeRecord, AttachmentRecord, CaptureRecord, MachineRecord, OutputRecord, ProcessRecord, StopRecord,
} from "./records";
import { project, words } from "./records";
import { inboxItem, type InboxItem, type InboxPlace } from "./inbox";
import { sessionState } from "./state";

// The moment the samples are seen from: 1 October 2026, 10:48.
const now = new Date(2026, 9, 1, 10, 48);

// Today at a time, or `days` before.
function at(h: number, m: number, s = 0, days = 0) {
  return new Date(2026, 9, 1 - days, h, m, s).toISOString();
}
const ago = (d: number) => ({ days: d });
const day = (h: number, m: number, s: number, { days }: { days: number }) => at(h, m, s, days);

const ben: AuthorRecord = { id: "u-ben", name: "Ben Bonnet" };
const maya: AuthorRecord = { id: "u-maya", name: "Maya Laurent" };
const tom: AuthorRecord = { id: "u-tom", name: "Tom Weber" };

const repos: RepoRecord[] = [
  { id: "r-dummy", name: "benbonnet/dummy-rails", owner: "benbonnet", defaultBranch: "main", environments: [{ id: "e-dummy-dev", name: "development", providerName: "daytona" }, { id: "e-dummy-staging", name: "staging", providerName: "daytona" }] },
  { id: "r-nvoi", name: "northwind/nvoi", owner: "northwind", defaultBranch: "main", environments: [{ id: "e-nvoi-dev", name: "development", providerName: "daytona" }, { id: "e-nvoi-preview", name: "preview", providerName: "hetzner" }] },
  { id: "r-billing", name: "northwind/billing", owner: "northwind", defaultBranch: "trunk", environments: [{ id: "e-billing-dev", name: "development", providerName: "daytona" }] },
  { id: "r-infra", name: "northwind/infra", owner: "northwind", defaultBranch: null, environments: [] },
];

const agents: AgentRecord[] = [
  { id: "a-dev", name: "Dev", slug: "dev", model: "sonnet" },
  { id: "a-reviewer", name: "Reviewer", slug: "reviewer", tagline: "Reviews pull requests" },
];

function worktree(id: string, repo: string, env: string, branch: string, state: string, o: { hostname?: string; serving?: boolean; pr?: PullRequestRecord; days?: number } = {}): WorktreeRecord {
  return { id: `w-${id}`, repoId: repo, environmentId: env, branch, state, hostname: o.hostname, serving: o.serving ?? false, createdAt: at(9, 0, 0, o.days ?? 0), pullRequest: o.pr };
}

function session(id: string, title: string, status: string, repo: string, env: string, w: WorktreeRecord, updated: string, archived = false): SessionRecord {
  const people = { health: [ben, maya], billing: [ben], sandbox: [maya], secrets: [ben, maya, tom], readme: [tom] }[id];
  return { id: `s-${id}`, title, status, archived, agentId: "a-dev", repoId: repo, environmentId: env, worktree: w, createdAt: w.createdAt, updatedAt: updated, people };
}

const health = session("health", "Health endpoint", "waiting", "r-dummy", "e-dummy-dev",
  worktree("health", "r-dummy", "e-dummy-dev", "dummy-rails-4f2a91", "running", { hostname: "dummy-rails-4f2a91.nvoi.dev", serving: true, pr: { changed: 3 } }), at(10, 46));
const billing = session("billing", "Billing webhooks", "running", "r-billing", "e-billing-dev",
  worktree("billing", "r-billing", "e-billing-dev", "billing-77c0de", "running", { pr: { changed: 2 } }), at(10, 44));
const sandbox = session("sandbox", "Add a sandbox check to the README", "running", "r-nvoi", "e-nvoi-dev",
  worktree("sandbox", "r-nvoi", "e-nvoi-dev", "nvoi-1b9e40", "starting", { pr: { changed: 0 } }), at(10, 47));
const secrets = session("secrets", "Rotate preview secrets", "idle", "r-dummy", "e-dummy-staging",
  worktree("secrets", "r-dummy", "e-dummy-staging", "dummy-rails-a03f55", "failed", { pr: { changed: 0 } }), at(9, 31));
const readme = session("readme", "Note README check, push PR", "idle", "r-nvoi", "e-nvoi-dev",
  worktree("readme", "r-nvoi", "e-nvoi-dev", "nvoi-5d21aa", "paused", { pr: { url: "https://github.com/northwind/nvoi/pull/212", state: "merged", changed: 1 }, days: 1 }), at(17, 12, 0, 1));
const darkMode = session("dark", "Dark mode for the settings page", "idle", "r-nvoi", "e-nvoi-preview",
  worktree("dark", "r-nvoi", "e-nvoi-preview", "nvoi-c8e112", "paused", { pr: { url: "https://github.com/northwind/nvoi/pull/214", state: "open", changed: 6 }, days: 3 }), at(9, 2, 0, 3));
const flaky = session("flaky", "Flaky spec in checkout_test", "idle", "r-dummy", "e-dummy-dev",
  worktree("flaky", "r-dummy", "e-dummy-dev", "dummy-rails-90ab31", "paused", { pr: { changed: 1 }, days: 16 }), at(11, 20, 0, 16));
const old = session("old", "Upgrade to Rails 8", "idle", "r-dummy", "e-dummy-dev",
  worktree("old", "r-dummy", "e-dummy-dev", "dummy-rails-11fe02", "paused", { pr: { url: "https://github.com/benbonnet/dummy-rails/pull/40", state: "merged", changed: 12 }, days: 40 }), at(12, 0, 0, 40), true);
const untitled = session("untitled", "Untitled", "idle", "r-billing", "e-billing-dev",
  worktree("untitled", "r-billing", "e-billing-dev", "billing-77c0de", "running", { pr: { changed: 0 } }), at(10, 48));

let serial = 0;
const id = () => `ev-${++serial}`;

// What the API serves with each call of the tools these samples use (`Event.label`, `Event.command`): its label and
// the input that is its one line.
const served: Record<string, [string, string?]> = {
  Bash: ["Bash", "command"], Read: ["Read", "file_path"], Edit: ["Edit", "file_path"], Write: ["Write", "file_path"], Grep: ["Search", "pattern"],
  Task: ["Subagent", "description"], ask_user: ["Question"], push_branch: ["Push branch"], create_pull_request: ["Pull request", "title"],
  provision__box: ["Starting your machine", "name"], provision__seed: ["Waiting for the seed machine", "name"],
  provision__checkout: ["Setting up your checkout", "name"], provision__setup: ["Running setup", "name"],
};
function named(tool: string | null | undefined, input: string): Pick<EventRecord, "label" | "command"> {
  const [label, key] = served[(tool ?? "").replace("mcp__nvoi__", "")] ?? [tool ?? ""];
  const value = key ? (JSON.parse(input || "{}") as Record<string, unknown>)[key] : undefined;
  return { label, command: value === undefined ? "" : String(value) };
}

function call(tool: string, input: string, time: string, use: string, o: { approval?: string; outcome?: string; by?: AuthorRecord; decided?: string } = {}): EventRecord {
  return { id: id(), kind: "tool_use", content: input, tool, ...named(tool, input), toolUseId: use, approvalStatus: o.approval, outcome: o.outcome, decidedBy: o.by, decidedAt: o.decided, createdAt: time };
}
const result = (use: string, content: string, time: string): EventRecord => ({ id: id(), kind: "tool_result", content, toolUseId: use, createdAt: time });
const said = (content: string, time: string): EventRecord => ({ id: id(), kind: "message", content, createdAt: time });
const status = (time: string): EventRecord => ({ id: id(), kind: "status", content: "init", createdAt: time });
const turn = (t: Omit<TurnRecord, "events"> & { events?: EventRecord[] }): TurnRecord => ({ events: [], ...t });

const mcp = "mcp__nvoi__";

const askAccess = `{"questions":[{"question":"Who can reach /health?","header":"Access","multiSelect":false,"options":[{"label":"Public","description":"Load balancers probe it without a token"},{"label":"Signed in","description":"Only members"}]}]}`;
const askRetries = `{"questions":[{"question":"How many times should a failed webhook be retried?","header":"Retries","multiSelect":false,"options":[{"label":"3 times","description":"Over about ten minutes"},{"label":"8 times","description":"Over a day, as Stripe does"}]}]}`;

const healthTurns: TurnRecord[] = [
  turn({
    id: "t-h1", prompt: "Add a /health endpoint that returns the app version and the database status, with a request test.", status: "awaiting_approval",
    createdAt: at(10, 42), author: ben, requestedBy: [ben],
    events: [
      status(at(10, 42, 2)),
      call("Read", `{"file_path":"config/routes.rb"}`, at(10, 42, 4), "c1"),
      result("c1", "Rails.application.routes.draw do", at(10, 42, 4)),
      call("Read", `{"file_path":"config/version.rb"}`, at(10, 42, 5), "c2"),
      result("c2", 'VERSION = "1.4.2"', at(10, 42, 5)),
      call("Grep", `{"pattern":"def up"}`, at(10, 42, 6), "c3"),
      result("c3", "", at(10, 42, 7)),
      said("The app has no health route yet. Rails 8 ships `/up`, which only checks boot; I’ll add a separate controller that also pings the database and reads the version from `config/version.rb`.", at(10, 42, 18)),
      call("Edit", `{"file_path":"app/controllers/health_controller.rb"}`, at(10, 42, 30), "c4"),
      result("c4", "ok", at(10, 42, 31)),
      call("Edit", `{"file_path":"config/routes.rb"}`, at(10, 42, 33), "c5"),
      result("c5", "ok", at(10, 42, 33)),
      call("Bash", `{"command":"bin/rails test test/requests/health_test.rb","description":"Run the health tests"}`, at(10, 42, 40), "c6"),
      result("c6", "3 runs, 7 assertions, 0 failures", at(10, 42, 52)),
      call(mcp + "ask_user", askAccess, at(10, 43), "c7", { approval: "approved", outcome: "Public", by: ben, decided: at(10, 44) }),
      said("Public it is, cached for five seconds. The branch is pushed; the pull request waits for you.", at(10, 44, 30)),
      call(mcp + "push_branch", "{}", at(10, 44, 40), "c8", { outcome: "Pushed dummy-rails-4f2a91" }),
      call(mcp + "create_pull_request", `{"title":"Add /health endpoint","body":"Adds a health controller."}`, at(10, 45), "c9", { approval: "pending" }),
    ],
  }),
];

const healthNotes: NoteRecord[] = [
  {
    id: "n-1", author: maya, text: "@Ben Load balancer probes hit it every 5s, keep it public and cheap.", mentions: [ben], createdAt: at(10, 46),
    replies: [{ id: "n-2", parentId: "n-1", author: ben, text: "Agreed.", createdAt: at(10, 47) }],
  },
];

const detail = (session: SessionRecord, repo: RepoRecord, turns: TurnRecord[], notes: NoteRecord[] = []): SessionDetail => ({ session, agent: agents[0], repo, turns, notes });

// Waiting on your approval: a pull request to open.
const waiting = detail(health, repos[0], healthTurns, healthNotes);

// Waiting on your answer: a question with options.
const question = detail({ ...billing, status: "waiting", updatedAt: at(10, 31) }, repos[2], [
  turn({
    id: "t-q1", prompt: "Retry failed Stripe webhooks with a backoff.", status: "awaiting_approval", createdAt: at(10, 30), author: tom,
    events: [
      call("Read", `{"file_path":"app/jobs/webhook_job.rb"}`, at(10, 30, 5), "q1"),
      result("q1", "", at(10, 30, 6)),
      said("The job gives up after the first failure. Before I add retries I need one decision.", at(10, 30, 20)),
      call(mcp + "ask_user", askRetries, at(10, 31), "q2", { approval: "pending" }),
    ],
  }),
]);

// The agent working, a message queued behind it.
const working = detail(billing, repos[2], [
  turn({
    id: "t-b1", prompt: "Make the webhook handler idempotent: Stripe sends the same event twice.", status: "succeeded", createdAt: at(10, 20), author: tom,
    events: [
      call("Grep", `{"pattern":"stripe_event_id"}`, at(10, 20, 4), "b1"),
      result("b1", "", at(10, 20, 5)),
      said("Events are not stored yet. I’ll keep each event id in `stripe_events` with a unique index and skip the ones already there.", at(10, 20, 30)),
    ],
  }),
  turn({
    id: "t-b2", prompt: "Go ahead, and add a test that sends the same event twice.", status: "running", createdAt: at(10, 40), author: tom,
    events: [
      call("Write", `{"file_path":"db/migrate/20261001_create_stripe_events.rb"}`, at(10, 40, 10), "b2"),
      result("b2", "ok", at(10, 40, 11)),
      call("Edit", `{"file_path":"app/controllers/webhooks_controller.rb"}`, at(10, 40, 20), "b3"),
      result("b3", "ok", at(10, 40, 21)),
      call("Bash", `{"command":"bin/rails db:migrate && bin/rails test test/controllers/webhooks_controller_test.rb","description":"Migrate and run the webhook tests"}`, at(10, 44), "b4"),
    ],
  }),
  turn({ id: "t-b3", prompt: "Also log the duplicates at info level.", status: "queued", createdAt: at(10, 45), author: maya }),
]);

// The agent at work, having spoken once: the run before what it said is closed, the run after it open. The calls carry
// what they printed and changed, for rows that open.
const speaking = detail(billing, repos[2], [
  turn({
    id: "t-s1", prompt: "Make the webhook handler idempotent: Stripe sends the same event twice.", status: "running", createdAt: at(10, 20), author: tom,
    events: [
      call("Read", `{"file_path":"app/controllers/webhooks_controller.rb"}`, at(10, 20, 4), "s1"),
      result("s1", "     1\tclass WebhooksController < ApplicationController\n     2\t  def create\n     3\t    event = Stripe::Webhook.construct_event(request.body.read, signature, secret)\n     4\t    Billing.handle(event)\n     5\t    head :ok\n     6\t  end\n     7\tend", at(10, 20, 5)),
      call("Grep", `{"pattern":"stripe_event_id","path":"app"}`, at(10, 20, 8), "s2"),
      result("s2", "No matches found", at(10, 20, 9)),
      said("Events are not stored yet. I’ll keep each event id in `stripe_events` with a unique index and skip the ones already there.", at(10, 20, 30)),
      call("Edit", `{"file_path":"app/controllers/webhooks_controller.rb","old_string":"    Billing.handle(event)","new_string":"    return head :ok if StripeEvent.exists?(stripe_id: event.id)\\n\\n    StripeEvent.create!(stripe_id: event.id)\\n    Billing.handle(event)"}`, at(10, 21), "s3"),
      result("s3", "The file app/controllers/webhooks_controller.rb has been updated.", at(10, 21, 1)),
      call("Bash", `{"command":"bin/rails test test/controllers/webhooks_controller_test.rb test/models/stripe_event_test.rb --seed 1207 2>&1 | tail -n 40","description":"Run the webhook tests"}`, at(10, 21, 10), "s4"),
      result("s4", "Run options: --seed 1207\n\n# Running:\n\n.....F\n\nFailure:\nWebhooksControllerTest#test_skips_a_second_delivery [test/controllers/webhooks_controller_test.rb:31]:\nExpected: 1\n  Actual: 2\n\n6 runs, 11 assertions, 1 failures, 0 errors, 0 skips", at(10, 21, 18)),
      call("Bash", `{"command":"bin/rails db:migrate","description":"Migrate"}`, at(10, 21, 30), "s5"),
    ],
  }),
]);

// Two members wrote while the agent worked: their messages started together as one turn, each in its writer's name,
// and the call it parked was asked for both.
const folded = detail({ ...billing, status: "waiting", updatedAt: at(10, 52) }, repos[2], [
  turn({
    id: "t-f1", prompt: "Make the webhook handler idempotent: Stripe sends the same event twice.", status: "succeeded", createdAt: at(10, 20), author: tom, requestedBy: [tom],
    events: [
      call("Grep", `{"pattern":"stripe_event_id"}`, at(10, 20, 4), "f1"),
      result("f1", "", at(10, 20, 5)),
      said("Each event id is now kept in `stripe_events` with a unique index; a second delivery is skipped.", at(10, 24)),
    ],
  }),
  turn({
    id: "t-f2", prompt: "Also log the duplicates at info level.", status: "awaiting_approval", createdAt: at(10, 22), author: ben,
    folded: [{ id: "t-f3", prompt: "And put the event id in that log line, so support can search by it.", createdAt: at(10, 23), author: maya }],
    requestedBy: [ben, maya],
    events: [
      call("Edit", `{"file_path":"app/controllers/webhooks_controller.rb"}`, at(10, 24, 10), "f2"),
      result("f2", "ok", at(10, 24, 11)),
      said("Duplicates are logged at info level with their event id, e.g. `duplicate stripe event evt_1Q2w`. I’ll push the branch.", at(10, 25)),
      call(mcp + "push_branch", "{}", at(10, 25, 10), "f3", { approval: "pending" }),
    ],
  }),
]);

const d3 = ago(3);
// Nothing happening: the last turn succeeded.
const idle = detail(darkMode, repos[1], [
  turn({
    id: "t-d1", prompt: "Add a dark mode to the settings page, following the system setting.", status: "succeeded", createdAt: day(14, 40, 0, d3), author: ben,
    events: [
      call("Read", `{"file_path":"app/assets/stylesheets/settings.css"}`, day(14, 40, 5, d3), "d1"),
      result("d1", "", day(14, 40, 6, d3)),
      call("Edit", `{"file_path":"app/assets/stylesheets/settings.css"}`, day(14, 41, 0, d3), "d2"),
      result("d2", "ok", day(14, 41, 2, d3)),
      call(mcp + "create_screenshot", `{"url":"/settings","label":"Settings, dark"}`, day(14, 42, 0, d3), "d3"),
      result("d3", "ok", day(14, 42, 6, d3)),
      call(mcp + "create_pull_request", `{"title":"Dark mode for settings","body":"The settings page follows the system appearance.\\n\\nContrast of disabled buttons is 4.6:1 in dark mode."}`, day(14, 43, 0, d3), "d4", { approval: "approved", outcome: "pull request opened: https://github.com/northwind/nvoi/pull/214", by: ben, decided: day(14, 50, 0, d3) }),
      said("The pull request is open: the settings page follows the system appearance.", day(14, 51, 0, d3)),
    ],
  }),
  turn({ id: "t-d2", prompt: "Use the same colours for the billing page.", status: "cancelled", createdAt: day(15, 0, 0, d3), author: ben }),
  turn({
    id: "t-d3", prompt: "Check the contrast of the disabled buttons in dark mode.", status: "succeeded", createdAt: day(15, 1, 0, d3), author: ben, noteId: "n-d1",
    events: [
      call("Read", `{"file_path":"app/assets/stylesheets/buttons.css"}`, day(15, 1, 5, d3), "d5"),
      result("d5", "", day(15, 1, 6, d3)),
      said("Disabled buttons sit at 3.1:1 on the dark background; I raised them to 4.6:1.", day(15, 2, 0, d3)),
    ],
  }),
], [{ id: "n-d1", author: maya, text: "Check the contrast of the disabled buttons in dark mode.", turnId: "t-d3", createdAt: day(14, 58, 0, d3) }]);

// Files attached to messages (`TurnResource.files`), their thumbnails as a box rendered them; and captures. The gallery
// serves the pictures from `public/samples`.
const office = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const attachment = (id: string, name: string, contentType: string, byteSize: number, state: string, thumb?: string): AttachmentRecord => ({
  id, name, contentType, byteSize, url: `/samples/${name}`, thumbnailState: state, thumbnailUrl: thumb ? `/samples/${thumb}` : null,
});
const contract = attachment("f-1", "contract.pdf", "application/pdf", 90_069, "ready", "contract.png");
const policy = attachment("f-2", "policy.docx", office, 18_240, "ready", "policy.png");
const whiteboard = attachment("f-3", "whiteboard.png", "image/png", 14_703, "ready", "whiteboard.png");
const capture = (id: string, label: string, url: string, picture: string, createdAt: string, description?: string): CaptureRecord => ({
  id, kind: "screenshot", label, description, url, contentType: "image/png", byteSize: 40_000, fileUrl: `/samples/${picture}`, thumbnailUrl: `/samples/${picture}`, createdAt,
});

const attached = detail(health, repos[0], [
  turn({
    id: "t-a1", prompt: "Here is the signed contract, the refund policy and the checkout sketch. Make the checkout match them.", status: "succeeded",
    createdAt: at(10, 20), author: ben, files: [contract, policy, whiteboard],
    events: [
      call("Read", `{"file_path":"/mnt/data/attachments/t-a1/contract.pdf"}`, at(10, 20, 5), "a1"),
      result("a1", "", at(10, 20, 8)),
      said("The contract renews quarterly and the policy gives fourteen days for refunds; the sketch has three steps. I will start with the totals step.", at(10, 21, 0)),
    ],
  }),
]);

const pendingFiles = detail(health, repos[0], [
  turn({
    id: "t-p1", prompt: "The new price list and last month's export.", status: "running", createdAt: at(10, 46), author: maya,
    files: [attachment("f-4", "prices.pdf", "application/pdf", 240_118, "pending"), attachment("f-5", "export.csv", "text/csv", 3_410, "none")],
  }),
]);

const screenshots = detail(health, repos[0], [
  turn({
    id: "t-s1", prompt: "Show me the members page and the usage page after the change.", status: "succeeded", createdAt: at(10, 30), author: ben,
    events: [
      call(mcp + "create_screenshot", `{"url":"http://localhost:3000/members","label":"Members page"}`, at(10, 30, 5), "s1"),
      result("s1", "captured", at(10, 30, 14)),
      call(mcp + "create_screenshot", `{"url":"http://localhost:3000/usage","label":"Usage page"}`, at(10, 30, 20), "s2"),
      result("s2", "captured", at(10, 30, 29)),
      said("Both pages render with the new rows: 60pt tall, the role last on the right.", at(10, 31, 0)),
    ],
    captures: [
      capture("c-1", "Members page", "http://localhost:3000/members", "members.png", at(10, 30, 13), "Twelve members, roles on the right"),
      capture("c-2", "Usage page", "http://localhost:3000/usage", "usage.png", at(10, 30, 28)),
    ],
  }),
]);

// What the agent's browser kept (`TurnResource.captures`); the gallery serves the files from its public folder.
const kept = (c: Omit<CaptureRecord, "contentType" | "byteSize">): CaptureRecord => ({
  ...c, contentType: c.kind === "recording" ? "video/mp4" : "image/png", byteSize: c.kind === "recording" ? 73013 : 22784,
});

// The agent changed a page, checked it with browse and filmed it with record_video: each capture after the call that
// made it.
const browsed = detail({ ...health, title: "Members page spacing", status: "idle", updatedAt: at(10, 40) }, repos[0], [
  turn({
    id: "t-b1", prompt: "Tighten the members table and show me the page, scrolled, once it is done.", status: "succeeded", createdAt: at(10, 31), author: ben, requestedBy: [ben],
    events: [
      call("Edit", `{"file_path":"app/views/members/index.html.erb"}`, at(10, 31, 20), "b1"),
      result("b1", "ok", at(10, 31, 22)),
      call(mcp + "browse", `{"url":"http://localhost:3000/members","steps":[{"action":"wait","selector":"table"}],"label":"Members page"}`, at(10, 32, 0), "b2"),
      result("b2", "after 1 steps at http://localhost:3000/members (HTTP 200) \"Members\"; kept a screenshot \"Members page\".", at(10, 32, 9)),
      call(mcp + "record_video", `{"url":"http://localhost:3000/usage","steps":[{"action":"scroll","by":300},{"action":"scroll","by":-300}],"label":"Usage page, scrolled"}`, at(10, 33, 0), "b3"),
      result("b3", "recorded \"Usage page, scrolled\": 2 steps from http://localhost:3000/usage (74 KB)", at(10, 33, 21)),
      said("The rows are 60pt tall now and the role sits last on the right. The picture shows the members page; the video scrolls the usage page.", at(10, 33, 30)),
    ],
    captures: [
      kept({ id: "c-b1", kind: "screenshot", label: "Members page", url: "http://localhost:3000/members", fileUrl: "/samples/members.png", createdAt: at(10, 32, 9) }),
      kept({
        id: "c-b2", kind: "recording", label: "Usage page, scrolled", description: "Scrolls to the machines chart and back.", url: "http://localhost:3000/usage",
        fileUrl: "/samples/usage.mp4", posterUrl: "/samples/usage.png", createdAt: at(10, 33, 21),
      }),
    ],
  }),
]);

const sub = (kind: string, content: string, time: string, o: Partial<EventRecord>): EventRecord =>
  ({ id: id(), kind, content, createdAt: time, ...(kind === "tool_use" ? named(o.tool, content) : {}), ...o });

// An app made in nvoi, its agent working through two sub-agents: the head ships instead of opening a pull request.
const delegating = detail(
  session("app", "Translate the app", "running", "r-nvoi", "e-nvoi-dev", worktree("app", "r-nvoi", "e-nvoi-dev", "nvoi-7e01bc", "running", { pr: { changed: 5, ship: true } }), at(10, 46)),
  repos[1],
  [
    turn({
      id: "t-g1", prompt: "Audit the app's pages for missing translations and fix them.", status: "running", createdAt: at(10, 40), author: ben,
      spend: { inputTokens: 21_400, outputTokens: 9_800, cacheReadTokens: 180_000, cacheWriteTokens: 12_000, cents: 64 },
      events: [
        call("Task", `{"description":"Find missing keys","subagent_type":"explorer","prompt":"List every view with a hard-coded string."}`, at(10, 40, 10), "g1"),
        sub("tool_use", `{"pattern":"\\"[A-Z][a-z]+ [a-z]+","path":"app/views"}`, at(10, 40, 20), { tool: "Grep", toolUseId: "g1a", parentToolUseId: "g1" }),
        sub("tool_result", "app/views/settings/show.html.erb", at(10, 40, 22), { toolUseId: "g1a", parentToolUseId: "g1" }),
        sub("tool_use", `{"file_path":"app/views/settings/show.html.erb"}`, at(10, 40, 30), { tool: "Read", toolUseId: "g1b", parentToolUseId: "g1" }),
        sub("tool_result", "", at(10, 40, 31), { toolUseId: "g1b", parentToolUseId: "g1" }),
        sub("message", "Five views still carry English text; settings has the most.", at(10, 41, 50), { parentToolUseId: "g1" }),
        sub("task", `{"state":"notification","status":"completed","summary":"12 hard-coded strings in 5 views.","tools":14,"tokens":18400}`, at(10, 42), { toolUseId: "g1" }),
        result("g1", "12 hard-coded strings in 5 views.", at(10, 42)),
        call("Task", `{"description":"Translate the settings pages","subagent_type":"general"}`, at(10, 42, 10), "g2"),
        result("g2", "Async agent launched successfully.\nagentId: a7f3c2", at(10, 42, 11)),
        // A person's message to the sub-agent while the turn runs, which the agent passes on with SendMessage.
        sub("steer", "Use vous, not tu, on every page.", at(10, 44), { parentToolUseId: "g2", author: ben, read: true }),
        call("SendMessage", `{"to":"a7f3c2","message":"Use vous, not tu, on every page."}`, at(10, 44, 10), "g3"),
        sub("message", "Switching the settings strings to vous.", at(10, 44, 30), { parentToolUseId: "g3" }),
        sub("task", `{"state":"progress","activity":"Editing config/locales/fr.yml","tools":6,"tokens":7200}`, at(10, 46), { toolUseId: "g2" }),
      ],
    }),
  ],
);

// Questions, one of them with several picks, waiting in the composer.
const questions: SessionDetail = {
  ...question,
  turns: [
    turn({
      id: "t-q2", prompt: "Retry failed Stripe webhooks with a backoff.", status: "awaiting_approval", createdAt: at(10, 30), author: tom,
      events: [
        said("Two decisions before I add retries.", at(10, 30, 20)),
        call(mcp + "ask_user", `{"questions":[{"question":"How many times should a failed webhook be retried?","header":"Retries","multiSelect":false,"options":[{"label":"3 times","description":"Over about ten minutes"},{"label":"8 times","description":"Over a day, as Stripe does"}]},{"question":"Which events should be retried?","header":"Events","multiSelect":true,"options":[{"label":"invoice.paid","description":""},{"label":"customer.subscription.updated","description":""},{"label":"charge.refunded","description":""}]}]}`, at(10, 31), "q3", { approval: "pending" }),
      ],
    }),
  ],
};

// What the shell printed since the terminal opened.
const shell: TerminalLine[] = [
  { prompt: "deploy@sandbox:/workspace$", text: "bin/rails test test/requests/health_test.rb" },
  { text: "Running 3 tests in a single process" },
  { text: "..." },
  { text: "Finished in 0.412s, 7.28 runs/s" },
  { text: "3 runs, 7 assertions, 0 failures, 0 errors, 0 skips", tone: "green" },
];

// The machine could not be set up.
const failedSetup = detail(secrets, repos[0], [
  turn({
    id: "t-f1", prompt: "Rotate the preview secrets and update the staging variables.", status: "failed", createdAt: at(9, 30), author: ben,
    events: [
      call("provision__box", "{}", at(9, 30, 2), "p1"),
      result("p1", "done", at(9, 30, 20)),
      call("provision__checkout", "{}", at(9, 30, 21), "p2"),
      result("p2", "done", at(9, 30, 29)),
      call("provision__setup", `{"name":"bundle install"}`, at(9, 30, 30), "p3"),
      result("p3", "failed: bundle install exited 5", at(9, 31, 2)),
      sub("error", "The machine could not be started: setup command bundle install exited 5", at(9, 31, 3), {}),
    ],
  }),
]);

// The machine starting for the first message.
const starting = detail(sandbox, repos[1], [
  turn({
    id: "t-s1", prompt: "Add a sandbox check to the README and push a pull request.", status: "queued", createdAt: at(10, 46), author: maya,
    events: [
      call("provision__box", "{}", at(10, 46, 2), "s1"),
      result("s1", "done", at(10, 46, 40)),
      call("provision__seed", "{}", at(10, 46, 41), "s2"),
      result("s2", "done", at(10, 46, 42)),
      call("provision__checkout", "{}", at(10, 46, 43), "s3"),
    ],
  }),
]);

const d40 = ago(40);
// Archived: out of the list, still readable.
const archived = detail(old, repos[0], [
  turn({
    id: "t-o1", prompt: "Upgrade the app to Rails 8 and fix what breaks.", status: "succeeded", createdAt: day(11, 0, 0, d40), author: ben,
    events: [
      call("Bash", `{"command":"bundle update rails"}`, day(11, 1, 0, d40), "o1"),
      result("o1", "", day(11, 3, 0, d40)),
      call("Bash", `{"command":"bin/rails test"}`, day(11, 4, 0, d40), "o2"),
      result("o2", "", day(11, 6, 0, d40)),
      said("Rails 8.0.2 is in and the suite passes. The pull request was merged.", day(11, 7, 0, d40)),
    ],
  }),
]);

// Joined on a checkout, nothing said yet.
const empty = detail(untitled, repos[2], []);

const patch = `diff --git a/app/controllers/health_controller.rb b/app/controllers/health_controller.rb
new file mode 100644
--- /dev/null
+++ b/app/controllers/health_controller.rb
@@ -0,0 +1,9 @@
+class HealthController < ApplicationController
+  def show
+    render json: { version: Nvoi::VERSION, database: database? }
+  end
+
+  private
+
+  def database? = ActiveRecord::Base.connection.active?
+end
diff --git a/config/routes.rb b/config/routes.rb
--- a/config/routes.rb
+++ b/config/routes.rb
@@ -1,3 +1,4 @@
 Rails.application.routes.draw do
+  get "health" => "health#show"
   get "up" => "rails/health#show"
 end
diff --git a/config/environments/production.rb b/config/environments/production.rb
--- a/config/environments/production.rb
+++ b/config/environments/production.rb
@@ -12,3 +12,3 @@
   config.cache_classes = true
-  config.cache_store = :null_store
+  config.cache_store = :memory_store, { expires_in: 5.seconds }
   config.eager_load = true`;

const changes: ChangesRecord = { patch, patchAt: at(10, 45) };

const files: FilesRecord = {
  paths: [
    "Gemfile", "README.md", "app/controllers/application_controller.rb", "app/controllers/health_controller.rb", "app/models/user.rb",
    "config/environments/production.rb", "config/routes.rb", "config/version.rb", "test/requests/health_test.rb",
  ],
  total: 9,
  changed: [
    { path: "app/controllers/health_controller.rb", status: "added" },
    { path: "config/routes.rb", status: "modified" },
    { path: "config/environments/production.rb", status: "modified" },
  ],
};

const file: FileRecord = {
  path: "app/controllers/health_controller.rb",
  size: 214,
  text: `class HealthController < ApplicationController
  def show
    render json: { version: Nvoi::VERSION, database: database? }
  end

  private

  def database? = ActiveRecord::Base.connection.active?
end`,
};

const logs: LogsRecord = {
  logs: [
    { step: "Starting your machine", createdAt: at(10, 46, 2) },
    { step: "box", output: "daytona: workspace nvoi-1b9e40 created\ndaytona: workspace started", createdAt: at(10, 46, 40) },
    { step: "Setting up your checkout", createdAt: at(10, 46, 43) },
    { step: "git clone", output: "Cloning into '/workspace'...\nreceiving objects: 64% (1210/1890)", createdAt: at(10, 47, 10) },
  ],
  seed: { state: "running", built: true },
};

const seedLogs: LogsRecord = {
  logs: [],
  seed: { state: "starting", built: false },
  seedLogs: [
    { step: "apt-get install", output: "Setting up postgresql-client-16 ...", createdAt: at(10, 46, 20) },
    { step: "mise install", output: "ruby 3.4.4 installed", createdAt: at(10, 46, 50) },
  ],
};

const seedAndLogs: LogsRecord = { logs: [{ step: "Waiting for the seed machine", createdAt: at(10, 46, 2) }], seed: seedLogs.seed, seedLogs: seedLogs.seedLogs };

function place(s: SessionRecord): InboxPlace {
  const repo = repos.find((r) => r.id === s.repoId)!;
  return { sessionId: s.id, title: s.title, repo: repo.name, owner: repo.owner, environment: repo.environments.find((e) => e.id === s.environmentId)?.name, branch: s.worktree.branch };
}

const d1 = ago(1);
// Who a note may name: the workspace's agents, and the members who reach the session.
const mentionables = {
  agents: [{ id: "a-dev", name: "Dev" }, { id: "a-review", name: "Reviewer" }],
  people: [{ id: "p-maya", name: "Maya Laurent" }, { id: "p-tom", name: "Tom Reyes" }],
};

const inbox: InboxItem[] = [
  { kind: "call", event: call(mcp + "create_pull_request", `{"title":"Add /health endpoint"}`, at(10, 45), "i1", { approval: "pending" }), place: place(health) },
  { kind: "call", event: call(mcp + "ask_user", askRetries, at(10, 31), "i2", { approval: "pending" }), place: place(billing) },
  { kind: "mention", id: "m-1", author: maya, text: "@Ben Load balancer probes hit it every 5s, keep it public and cheap.", handled: false, createdAt: at(10, 46), place: place(health) },
  { kind: "call", event: call(mcp + "create_pull_request", `{"title":"Dark mode for settings"}`, day(14, 43, 0, d1), "i3", { approval: "approved", outcome: "Opened northwind/nvoi#214", by: ben, decided: day(14, 50, 0, d1) }), place: place(darkMode) },
  { kind: "call", event: call(mcp + "push_branch", "{}", day(16, 2, 0, d1), "i4", { approval: "rejected", by: maya, decided: day(16, 5, 0, d1) }), place: place(readme) },
  {
    kind: "call",
    event: call(mcp + "ask_user", `{"questions":[{"question":"Keep the old /up route?","header":"Route","multiSelect":false,"options":[{"label":"Keep","description":""},{"label":"Remove","description":""}]}]}`, day(9, 12, 0, d3), "i5", { approval: "approved", outcome: "Keep", by: ben, decided: day(9, 20, 0, d3) }),
    place: place(flaky),
  },
  { kind: "health", id: "h-1", environmentId: "e-production", environment: "production", repo: "northwind/nvoi", owner: "northwind", status: "degraded", reasons: ["web: CrashLoopBackOff", "web: 1 of 2 replicas ready"], resolved: false, createdAt: at(10, 40) },
  { kind: "health", id: "h-2", environmentId: "e-production", environment: "production", repo: "northwind/nvoi", owner: "northwind", status: "down", reasons: ["no node is ready"], resolved: true, createdAt: day(11, 0, 0, d1) },
  { kind: "mention", id: "m-2", author: tom, text: "@Ben can you check the staging variables before I rotate them?", handled: true, createdAt: day(9, 0, 0, d3), place: place(secrets) },
];

const commanderSessions = [health, billing, sandbox];

const commander: CommanderGroup[] = [
  {
    title: "Sessions",
    rows: commanderSessions.map((s) => {
      const p = place(s);
      const [reason, tone] = sessionState.of(s);
      return { title: s.title, subtitle: `${project({ name: p.repo })} · ${p.environment ?? ""} · ${words.age(s.updatedAt, now)}`, lead: "session", right: { pill: [reason, tone] }, key: s.id };
    }),
  },
  { title: "Actions", rows: [{ title: "New session", lead: "plus", right: { keys: ["⌘", "N"] } }, { title: "New task…", lead: "task" }] },
  {
    title: "Go to",
    rows: [
      { title: "Inbox", lead: "inbox", right: { tag: String(inbox.filter(inboxItem.waiting).length) } },
      { title: "Repositories", lead: "repo" },
      { title: "Agents", lead: "bot" },
      { title: "Members", lead: "people" },
    ],
  },
  { title: "Workspaces", rows: [{ title: "Northwind", lead: "repo", workspace: true, right: { check: true } }, { title: "Acme", lead: "repo", workspace: true }] },
];

// `GET /sessions/{id}/machine`: a machine an hour into a session, its preview and the agent's turn up, a test run the
// agent started on top.
const proc = (pid: number, parent: number, user: string, name: string, command: string, cpu: number, mb: number, role?: string, killable = !role || role === "turn"): ProcessRecord => ({
  pid, parent, user, name, command, cpu, rss: mb * 1024 * 1024, memory: Math.round((mb / 7812) * 1000) / 10, started: at(9, 12), state: cpu > 50 ? "running" : "sleeping",
  role: role ?? null, turn: role === "turn" ? "turn-2" : null, killable: killable && ["deploy", "browser"].includes(user), logs: !!role && role !== "init" && role !== "sshd",
});
const machine: MachineRecord = {
  memory: { total: 8 * 1024 ** 3, used: 3.1 * 1024 ** 3, available: 4.9 * 1024 ** 3, swapTotal: 1024 ** 3, swapUsed: 0.2 * 1024 ** 3 },
  cpu: { load: [1.24, 0.92, 0.61], cores: 4 },
  disk: { mount: "/mnt/data", total: 10 * 1024 ** 3, used: 3.4 * 1024 ** 3, available: 6.6 * 1024 ** 3 },
  uptime: 3 * 3600 + 12 * 60,
  readAt: at(10, 46),
  processes: [
    proc(903, 902, "deploy", "npm", "npm test -- --runInBand", 96.4, 612),
    proc(701, 700, "deploy", "ruby", "bin/rails server -p 3000", 4.2, 402, "preview"),
    proc(902, 901, "deploy", "node", "/opt/nvoi/node/bin/node /opt/nvoi/node/bin/claude -p Add a health endpoint", 22.5, 296, "turn"),
    proc(4121, 1, "deploy", "node", "node scripts/watch.js --port 4000", 1.8, 188),
    proc(4200, 1, "browser", "chromium", "/mnt/data/playwright/chromium-1187/chrome-linux/chrome --headless", 0.6, 142),
    proc(4300, 1, "postgres", "postgres", "postgres: 16/main: checkpointer", 0.1, 64),
    proc(800, 1, "root", "boxd", "/usr/local/bin/boxd", 0.1, 21, "boxd"),
    proc(1, 0, "root", "init", "/sbin/init", 0, 12, "init"),
    proc(300, 1, "root", "sshd", "sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups", 0, 8, "sshd"),
  ],
};
const stopped: StopRecord = { pid: 4121, signal: "TERM", command: "node scripts/watch.js --port 4000", result: "stopped" };
const stillRunning: StopRecord = { ...stopped, result: "running" };
const output: OutputRecord = {
  pid: 701,
  name: "ruby",
  command: "bin/rails server -p 3000",
  source: "file",
  lines: [
    "=> Booting Puma",
    "=> Rails 8.1.0 application starting in development",
    "Puma starting in single mode...",
    "* Listening on http://0.0.0.0:3000",
    "Started GET \"/up\" for 127.0.0.1 at 2026-10-02 10:44:12 +0000",
    "Completed 200 OK in 4ms (Views: 0.2ms | ActiveRecord: 0.0ms)",
  ],
};
const noOutput: OutputRecord = { pid: 903, name: "npm", command: "npm test -- --runInBand", source: null, lines: [] };

// One conversation that holds every piece the conversation draws: files sent with a message, calls folded into an
// action card, captures, prose with code and tables, a note and its reply, and an approval waiting on a person.
const introNotes: NoteRecord[] = [
  {
    id: "n-i1", author: tom, text: "@Ben bundle install fails on the new nokogiri; pin it in the setup.", mentions: [ben], createdAt: at(9, 32),
    replies: [{ id: "n-i2", parentId: "n-i1", author: ben, text: "Pinned. Retrying with the files.", createdAt: at(9, 34) }],
  },
  { id: "n-i3", author: maya, text: "The refund policy changed last week; the docx is the current one.", createdAt: at(10, 25), replies: [] },
  {
    id: "n-i4", author: ben, text: "@Maya the members page is tighter now, can you check it on a phone?", mentions: [maya], createdAt: at(10, 35),
    replies: [{ id: "n-i5", parentId: "n-i4", author: maya, text: "Fine on a phone. The usage chart wraps, nothing else.", createdAt: at(10, 37) }],
  },
  {
    id: "n-i6", author: maya, text: "@Ben Load balancer probes hit it every 5s, keep it public and cheap.", mentions: [ben], createdAt: at(10, 46),
    replies: [
      { id: "n-i7", parentId: "n-i6", author: ben, text: "Agreed.", createdAt: at(10, 47) },
      { id: "n-i8", parentId: "n-i6", author: tom, text: "Only cache the 200s, or a recovered database still reads down.", createdAt: at(10, 48) },
    ],
  },
];

// A larger conversation: three people's messages, the agent's work between them, a thread of replies on a note.
const done = (t: TurnRecord): TurnRecord => ({ ...t, status: "succeeded" });
const intro = detail(
  health,
  repos[0],
  [...failedSetup.turns, ...attached.turns, ...browsed.turns.map(done), ...screenshots.turns, working.turns[0], ...delegating.turns.map(done), ...healthTurns],
  introNotes,
);

export const sessionSamples = {
  machine,
  stopped,
  stillRunning,
  output,
  noOutput,
  now,
  repos,
  agents,
  // `GET /sessions` and `GET /sessions?archived=true` together; the screen shows one or the other.
  sessions: [health, billing, sandbox, secrets, readme, darkMode, flaky, old],
  // `GET /sessions?q=stripe`: one session matched by its title (no excerpt), two by what was said in them.
  found: [
    { ...billing, title: "Stripe webhooks" },
    { ...secrets, excerpt: "Rotated the signing secret in the Stripe dashboard and updated STRIPE_WEBHOOK_SECRET on staging" },
    { ...readme, excerpt: "Refunds fail when the Stripe signing secret rotates, which happens once a year" },
  ],
  intro,
  waiting,
  question,
  questions,
  working,
  speaking,
  folded,
  idle,
  attached,
  pendingFiles,
  screenshots,
  browsed,
  delegating,
  failedSetup,
  starting,
  archived,
  empty,
  shell,
  changes,
  files,
  file,
  logs,
  seedLogs,
  seedAndLogs,
  inbox, mentionables,
  commander,
};
