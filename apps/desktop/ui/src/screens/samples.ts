// Sample data matching the Monochrome canvas, for the gallery and snapshots.
import type { TabInfo } from "../chrome";
import type { CommanderGroup } from "../commander";
import type { ComposerBadges, ComposerFlow } from "../composer";
import type { Bar, SessionSummary } from "../data";
import type { Person } from "../primitives";
import { avatarFills } from "../tokens";
import { memberModel, type ArtifactModel, type ConversationModel, type EnvironmentModel, type GateModel, type MemberModel, type Part, type RepositoryModel } from "./models";
import { describe } from "./routes";

const olive = avatarFills[1];
const slate = avatarFills[0];

const report: ArtifactModel = {
  title: "Health endpoint: what it checks",
  kind: "Document",
  glyph: "artifact",
  session: "Health endpoint",
  author: "Dev",
  initials: "CL",
  updated: "10:45",
  size: "2 pages",
  version: 3,
  saved: [
    { number: 3, author: "Dev", time: "10:45" },
    { number: 2, author: "Maya Laurent", time: "10:38" },
    { number: 1, author: "Dev", time: "10:31" },
  ],
  sections: [
    ["What /health returns", "A JSON body with the app version from config/version.rb and the database status. It answers 200 when the database responds, 503 otherwise."],
    ["Who can reach it", "Anyone: the load balancer probes it every five seconds without a token. The response carries no secrets."],
    ["Caching", "Responses are cached for five seconds, so the probes never touch the database more than once per interval."],
    ["Tests", "test/requests/health_test.rb covers the healthy case, a failed database and the cache. All three pass."],
  ],
};

const tabs: TabInfo[] = [
  { title: "Health endpoint", tone: "yellow" },
  { title: "Billing webhooks", tone: "blue" },
  { title: "Rotate preview secrets", tone: "red" },
  { title: "northwind.example.com", glyph: "globe" },
];

const badges: ComposerBadges = { agent: "Claude Code", repos: ["dummy-rails"], branch: "hz/health-endpoint", machine: { word: "Running", tone: "green" } };

const people: Person[] = [{ initials: "TW", fill: slate }, { initials: "BB" }, { initials: "MA", fill: olive }];

const parts: Part[] = [
  { kind: "message", author: "Ben", initials: "BB", time: "10:42", text: "Add a /health endpoint that returns the app version and the database status, with a request test." },
  { kind: "agent", name: "Dev", time: "10:42" },
  { kind: "actions", summary: "Read 3 files, ran 2 commands", time: "14s", actions: [{ tool: "read", target: "config/routes.rb", outcome: { kind: "value", text: "0.1s" } }] },
  {
    kind: "prose",
    text: "The app has no health route yet. Rails 8 ships `/up`, which only checks boot; I’ll add a separate controller that also pings the database and reads the version from `config/version.rb`.",
  },
  {
    kind: "actions",
    summary: "Edited 2 files, ran the tests, asked you",
    time: "41s",
    actions: [
      { tool: "edit", target: "app/controllers/health_controller.rb", outcome: { kind: "value", text: "+18", tone: "green" } },
      { tool: "edit", target: "config/routes.rb", outcome: { kind: "value", text: "+1", tone: "green" } },
      { tool: "bash", target: "bin/rails test test/requests/health_test.rb", outcome: { kind: "value", text: "3 passed", tone: "green" } },
      { tool: "ask", target: "Who can reach /health?", outcome: { kind: "decision", word: "Public", tone: "grey", by: "Ben · 10:44" } },
    ],
  },
  { kind: "prose", text: "Public it is, cached for five seconds. I wrote down what the endpoint checks for the team:\n\n| Check | Answers | Time |\n| :--- | :---: | ---: |\n| `config/version.rb` | 200 | 2 ms |\n| Database ping | 200 | 14 ms |\n| Database down | 503 | 31 ms |" },
  { kind: "artifact", artifact: report },
  { kind: "prose", text: "The branch is pushed; the pull request waits for you." },
  {
    kind: "actions",
    summary: "Pushed the branch, asked to open a pull request",
    time: "3s",
    actions: [
      { tool: "push", target: "hz/health-endpoint", outcome: { kind: "decision", word: "Pushed", tone: "green", by: "auto" } },
      { tool: "pr", target: "Add /health endpoint", outcome: { kind: "decision", word: "Waiting", tone: "yellow" }, state: "waiting" },
    ],
  },
  { kind: "note", author: "Maya", initials: "MA", time: "10:46", text: "Load balancer probes hit it every 5s, keep it public and cheap." },
];

const gate: GateModel = { title: "Open a pull request on dummy-rails", tool: "Pull request", detail: "4 files", added: 42, removed: 3 };

const conversation: ConversationModel = {
  tabs,
  activeTab: 0,
  workspace: "Northwind",
  initials: "BB",
  title: "Health endpoint",
  branch: "hz/health-endpoint",
  state: ["Needs your approval", "yellow"],
  changes: 4,
  parts,
  working: { text: "Dev is waiting on you", tone: "yellow", time: "1:12" },
  gate,
  badges,
  people,
  toast: ["Branch pushed", "green"],
};

const flowSteps = ["Plan", "Scaffold", "Migrate", "Build", "Test", "Lint", "Review", "Fix", "Retest", "Docs", "Changelog", "Version", "Stage", "Smoke", "Canary", "Approve", "Ship", "Tag", "Notify", "Close"];

const repositories: RepositoryModel[] = [
  { name: "benbonnet/dummy-rails", branch: "main", host: "github", connection: "benbonnet", environments: [{ name: "development", option: "S" }, { name: "staging", option: "M" }], sessions: 34 },
  {
    name: "northwind/web",
    branch: "main",
    host: "github",
    connection: "northwind",
    environments: [{ name: "development", option: "S" }, { name: "preview", option: "S" }, { name: "staging", option: "M" }],
    sessions: 21,
  },
  { name: "northwind/billing", branch: "trunk", host: "github", connection: "northwind", environments: [{ name: "development", option: "S" }], sessions: 9 },
  { name: "northwind/infra", host: "github", connection: "northwind", environments: [], sessions: 0 },
];

const environments: EnvironmentModel[] = [
  {
    name: "development",
    repository: "benbonnet/dummy-rails",
    branch: "main",
    option: "S",
    shape: "2x4",
    disk: 20,
    previewPort: 3000,
    manifest: "rails",
    database: { engine: "postgres", version: "16" },
    vars: [{ key: "RAILS_ENV", value: "development" }, { key: "RAILS_MASTER_KEY", secret: true }, { key: "STRIPE_SECRET_KEY", secret: true }],
    commands: [
      { kind: "setup", name: "install", command: "bundle install" },
      { kind: "setup", name: "database", command: "bin/rails db:prepare" },
      { kind: "preview", name: "web", command: "bin/rails server -p 3000", port: 3000 },
      { kind: "default", name: "test", command: "bin/rails test" },
    ],
  },
  {
    name: "staging",
    repository: "benbonnet/dummy-rails",
    branch: "staging",
    option: "M",
    shape: "4x8",
    disk: 40,
    previewPort: 3000,
    manifest: "hz.yml",
    database: { engine: "postgres", version: "16" },
    vars: [{ key: "RAILS_ENV", value: "staging" }, { key: "RAILS_MASTER_KEY", secret: true }, { key: "SENTRY_DSN", secret: true }],
    commands: [
      { kind: "setup", name: "install", command: "bundle install" },
      { kind: "preview", name: "web", command: "bin/rails server -p 3000", port: 3000 },
      { kind: "preview", name: "jobs", command: "bin/jobs" },
    ],
  },
  {
    name: "development",
    repository: "northwind/web",
    branch: "main",
    option: "S",
    shape: "4x8",
    disk: 30,
    previewPort: 3000,
    manifest: "hz.yml",
    database: { engine: "postgres", version: "17" },
    vars: [{ key: "DATABASE_URL", secret: true }],
    commands: [
      { kind: "setup", name: "install", command: "bin/setup --skip-server" },
      { kind: "preview", name: "web", command: "bin/dev", port: 3000 },
    ],
  },
  {
    name: "preview",
    repository: "northwind/web",
    branch: "main",
    option: "S",
    shape: "2x4",
    disk: 20,
    previewPort: 3000,
    manifest: "hz.yml",
    vars: [],
    commands: [{ kind: "preview", name: "web", command: "bin/dev", port: 3000 }],
  },
  {
    name: "development",
    repository: "northwind/billing",
    branch: "trunk",
    option: "S",
    shape: "2x4",
    disk: 20,
    previewPort: 5173,
    manifest: "node",
    vars: [{ key: "STRIPE_TEST_KEY", secret: true }],
    commands: [
      { kind: "setup", name: "install", command: "pnpm install" },
      { kind: "preview", name: "web", command: "pnpm dev", port: 5173 },
    ],
  },
];

const members: MemberModel[] = [
  memberModel({ name: "Ben Bonnet", email: "ben@northwind.dev", initials: "BB", role: "Owner", repositories: "All repositories", joined: "8 months ago", seen: "Now", you: true }),
  memberModel({ name: "Maya Laurent", email: "maya@northwind.dev", initials: "ML", fill: olive, role: "Admin", repositories: "3 repositories", joined: "3 months ago", seen: "2h ago" }),
  memberModel({ name: "Tom Weber", email: "tom@northwind.dev", initials: "TW", fill: slate, role: "Member", repositories: "dummy-rails", joined: "12 days ago", seen: "Yesterday" }),
  memberModel({ name: "Léa Martin", email: "lea@northwind.dev", initials: "LM", role: "Viewer", repositories: "web", joined: "Invited", seen: "Invited" }),
];

const sessions: [string, SessionSummary[]][] = [
  [
    "Today",
    [
      { title: "Health endpoint", reason: "Ship a fix · build", tone: "blue", owner: "benbonnet", repo: "dummy-rails", environment: "staging", age: "4m", people: [{ initials: "BB" }, { initials: "MA", fill: olive }] },
      { title: "Billing webhooks", reason: "Waiting on your approval", tone: "yellow", owner: "benbonnet", repo: "dummy-rails", environment: "staging", age: "38m", people: [{ initials: "TW", fill: slate }] },
      {
        title: "Note README check, push PR",
        reason: null,
        tone: "green",
        owner: "northwind",
        repo: "web",
        environment: "production",
        age: "1h",
        people: [{ initials: "MA", fill: olive }, { initials: "BB" }, { initials: "TW", fill: slate }],
      },
    ],
  ],
  [
    "Yesterday",
    [
      { title: "Add a sandbox check to the README", reason: null, tone: "grey", owner: "northwind", repo: "web", environment: "staging", age: "1d", people: [{ initials: "BB" }] },
      {
        title: "Rotate preview secrets",
        reason: "Setup failed at bundle install",
        tone: "red",
        owner: "benbonnet",
        repo: "dummy-rails",
        environment: "production",
        age: "1d",
        people: [{ initials: "TW", fill: slate }, { initials: "BB" }],
      },
    ],
  ],
];

const commander: CommanderGroup[] = [
  {
    title: "Sessions",
    rows: [
      { title: "Health endpoint", subtitle: "dummy-rails · staging · 4m", lead: "session", right: { pill: ["Needs your approval", "yellow"] } },
      { title: "Billing webhooks", subtitle: "dummy-rails · staging · 38m", lead: "session", right: { pill: ["Working", "blue"] } },
      { title: "Note README check, push PR", subtitle: "web · production · 1h", lead: "session", right: { pill: ["Done", "green"] } },
    ],
  },
  {
    title: "Actions",
    rows: [
      { title: "New session", lead: "plus", right: { keys: ["⌘", "N"] } },
      { title: "New task", lead: "task" },
      { title: "Open terminal", subtitle: "Health endpoint", lead: "terminal", right: { keys: ["⌃", "`"] } },
    ],
  },
  {
    title: "Go to",
    rows: [
      { title: "Inbox", lead: "inbox", right: { tag: "2" } },
      { title: "Repositories", lead: "repo" },
      { title: "Agents", lead: "bot" },
      { title: "Settings", lead: "gear" },
    ],
  },
  { title: "Workspaces", rows: [{ title: "Northwind", subtitle: "3 members", lead: "repo", workspace: true, right: { check: true } }] },
];

const tokenDays: [string, number, number, number][] = [
  ["17", 1.2, 0.4, 2.1], ["18", 2.0, 0.6, 3.0], ["19", 0.4, 0.1, 0.8], ["20", 0.2, 0.1, 0.3], ["21", 2.6, 0.9, 4.2],
  ["22", 3.1, 1.0, 4.8], ["23", 2.4, 0.7, 3.6], ["24", 2.9, 1.1, 4.4], ["25", 3.4, 1.2, 5.1], ["26", 0.6, 0.2, 0.9],
  ["27", 0.3, 0.1, 0.4], ["28", 3.8, 1.3, 5.6], ["29", 4.1, 1.5, 6.0], ["30", 2.2, 0.8, 3.1],
];

export const samples = {
  tabs,
  // The window's tabs with `path` shown in the last one.
  settingsTabs(path?: string, title?: string): TabInfo[] {
    const d = path ? describe(path) : { title: "Settings", glyph: "gear" };
    return [{ title: "Health endpoint", tone: "yellow" }, { title: "Billing webhooks", tone: "blue" }, { title: "northwind.example.com", glyph: "globe" }, { title: title ?? d.title, glyph: d.glyph }];
  },
  badges,
  flow: {
    name: "Ship a fix",
    steps: flowSteps.map((name) => ({ name, who: ["Review", "Approve"].includes(name) ? "Reviewer · you accept it" : "Dev · goes on by itself" })),
    current: 6,
  } satisfies ComposerFlow,
  repositories,
  environments,
  people,
  parts,
  report,
  artifacts: [
    report,
    { ...report, title: "Billing webhooks: retry plan", session: "Billing webhooks", author: "Tom Weber", initials: "TW", updated: "Yesterday", size: "4 pages" },
    { ...report, title: "Q3 platform review", kind: "Deck", glyph: "deck", session: "Note README check, push PR", author: "Maya Laurent", initials: "ML", updated: "Sept 28", size: "12 slides" },
    { ...report, title: "Usage explorer", kind: "App", glyph: "app", session: "Rotate preview secrets", author: "Ben Bonnet", initials: "BB", updated: "Sept 26", size: "1 page" },
  ] satisfies ArtifactModel[],
  gate,
  conversation,
  working: { ...conversation, state: ["Working", "blue"], gate: undefined, toast: undefined, working: { text: "Dev is working", tone: "blue", time: "0:42" } } satisfies ConversationModel,
  members,
  sessions,
  commander,
  tokens: tokenDays.map(([label, a, b, c]) => ({ label, values: [b, a, c] })) satisfies Bar[],
};
