// Fixtures of the settings pages, after `doc/openapi.yaml` and the web pages' models.
import type { BillingAccount, CreditLine, Member, MemberTool, Refusal, RoleLevel, RoleTool, ToolLevel, UsageDay, UsageEnvironment, UsageLine, UsageReport, UsageSpend, WhoamiModel } from "./models";
import { envKey } from "./models";

const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
const ahead = (days: number) => new Date(Date.now() + days * 86_400_000);

// The signed-in account's `user.id` (whoami), matched against a member's `user_id`.
const you = "0191c1a2-0000-7000-8000-000000000001";

const members: Member[] = [
  { id: "0191c1a2-1000-7000-8000-000000000001", userId: you, email: "ben@dee.mx", role: "admin", createdAt: ago(243) },
  { id: "0191c1a2-1000-7000-8000-000000000002", userId: "0191c1a2-0000-7000-8000-000000000002", email: "ana@nvoi.local", role: "admin", createdAt: ago(92) },
  { id: "0191c1a2-1000-7000-8000-000000000003", userId: "0191c1a2-0000-7000-8000-000000000003", email: "tom@nvoi.local", role: "manager", createdAt: ago(12) },
  { id: "0191c1a2-1000-7000-8000-000000000004", userId: "0191c1a2-0000-7000-8000-000000000004", email: "lea@nvoi.local", role: "editor", createdAt: ago(2) },
];

const workspaces = [
  { id: "0191c1a2-2000-7000-8000-000000000002", name: "ben", slug: "ben" },
  { id: "0191c1a2-2000-7000-8000-000000000001", name: "Acme", slug: "acme" },
];

const whoami: WhoamiModel = {
  user: { id: you, email: "ben@dee.mx", createdAt: ago(243), firstName: "Ben", lastName: "Bonnet", name: "Ben Bonnet" },
  workspace: workspaces[1],
  workspaces,
};

const staging: UsageEnvironment = { id: "env-staging", name: "staging", repo: "benbonnet/dummy-rails", shape: "4x8" };
const production: UsageEnvironment = { id: "env-production", name: "production", repo: "benbonnet/dummy-rails", shape: "2x4" };
const nvoiStaging: UsageEnvironment = { id: "env-nvoi", name: "staging", repo: "northwind/nvoi", shape: "8x16" };
const preview: UsageEnvironment = { id: "env-preview", name: "preview", repo: "northwind/billing", shape: "2x4" };

const ranges = [7, 14, 30, 90];

// A range of days, oldest first, with spend that rises on weekdays; the totals add up from the days.
function usage(days = 30): UsageReport {
  const shares: [string, number][] = [[staging.id, 0.46], [nvoiStaging.id, 0.28], [production.id, 0.16], [preview.id, 0.07], ["", 0.03]];
  const byDay: UsageDay[] = Array.from({ length: days }, (_, i) => {
    const date = ago(days - 1 - i);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const base = weekend ? 90 : 380 + ((i * 37) % 160);
    const running = base / 41;
    return {
      date, cents: Object.fromEntries(shares.map(([id, share]) => [id, Math.round(base * share)])), running, paused: running * 1.6,
      spend: weekend ? 140 : 610 + ((i * 53) % 290),
    };
  });
  const total = (id: string) => byDay.reduce((sum, d) => sum + (d.cents[id] ?? 0), 0);
  const spent = byDay.reduce((sum, d) => sum + Object.values(d.cents).reduce((a, b) => a + b, 0), 0);
  const scale = days / 30;
  const modelCents = byDay.reduce((sum, d) => sum + (d.spend ?? 0), 0);
  const tokens = (cents: number, runs: number): UsageSpend => ({
    cents, input: Math.round(cents * 9), output: Math.round(cents * 310), cacheRead: Math.round(cents * 5_200), cacheWrite: Math.round(cents * 420), runs,
  });
  const line = (environment: UsageEnvironment | undefined, setup: number, sessions: number): UsageLine => ({
    environment, cents: total(envKey(environment)), setup, sessions,
  });
  return {
    days, ranges, from: byDay[0]?.date ?? new Date(), to: new Date(), currency: "EUR", cents: spent, creditLeft: 4_210, spendable: true,
    running: 3, machinesAtOnce: 20, sessions: Math.round(75 * scale), byDay,
    environments: [
      line(staging, Math.round(total(staging.id) * 0.08), Math.floor(38 * scale)),
      line(nvoiStaging, Math.round(total(nvoiStaging.id) * 0.12), Math.floor(21 * scale)),
      line(production, Math.round(total(production.id) * 0.05), Math.floor(12 * scale)),
      line(preview, total(preview.id), 0),
      line(undefined, 0, 0),
    ],
    repositories: [
      { repo: staging.repo, cents: total(staging.id) + total(production.id), environments: 2 },
      { repo: nvoiStaging.repo, cents: total(nvoiStaging.id), environments: 1 },
      { repo: preview.repo, cents: total(preview.id), environments: 1 },
    ],
    machines: [
      { setup: false, branch: "nvoi/health-endpoint", environment: staging, session: { id: "s-health", title: "Health endpoint" }, cents: 2_184 * scale, running: 26.3 * scale },
      { setup: false, branch: "nvoi/billing-webhooks", environment: nvoiStaging, session: { id: "s-webhooks", title: "Billing webhooks" }, cents: 1_642 * scale, running: 9.9 * scale },
      { setup: true, environment: nvoiStaging, cents: 870 * scale, running: 5.2 * scale },
      { setup: false, branch: "nvoi/rotate-preview-secrets", environment: production, cents: 412 * scale, running: 9.9 * scale },
      { setup: true, environment: preview, cents: 96, running: 0.4 },
    ],
    storage: [
      { category: "images", environment: production, bytes: 3_400_000_000, cents: 4.8 * scale },
      { category: "artifacts", bytes: 640_000_000, cents: 0.9 * scale },
      { category: "repositories", bytes: 212_000_000, cents: 0.3 * scale },
      { category: "library", bytes: 48_000_000, cents: 0.07 * scale },
    ],
    spend: tokens(modelCents, Math.round(412 * scale)),
    agents: [
      { agent: { id: "a-dev", name: "Developer" }, sessions: Math.round(52 * scale), spend: tokens(modelCents * 0.71, Math.round(290 * scale)) },
      { agent: { id: "a-review", name: "Reviewer" }, sessions: Math.round(31 * scale), spend: tokens(modelCents * 0.22, Math.round(96 * scale)) },
      { agent: { id: "a-codex", name: "Codex" }, sessions: Math.round(9 * scale), spend: { ...tokens(modelCents * 0.07, Math.round(26 * scale)), cents: undefined } },
    ],
    costly: [
      { session: { id: "s-health", title: "Health endpoint" }, agent: "Developer", spend: tokens(2_960 * scale, 24) },
      { session: { id: "s-webhooks", title: "Billing webhooks" }, agent: "Developer", spend: tokens(2_115 * scale, 17) },
      { session: { id: "s-review", title: "Review the billing pull request" }, agent: "Reviewer", spend: tokens(840 * scale, 6) },
      { session: { id: "s-codex", title: "Rotate preview secrets" }, agent: "Codex", spend: { ...tokens(380 * scale, 4), cents: undefined } },
    ],
  };
}

// No machine ran in the range: the stats stay, the charts and lists give way to a line.
function usageEmpty(days = 30): UsageReport {
  const byDay = Array.from({ length: days }, (_, i) => ({ date: ago(days - 1 - i), cents: {}, running: 0, paused: 0 }));
  return {
    days, ranges, from: byDay[0].date, to: new Date(), currency: "EUR", cents: 0, creditLeft: 100, spendable: true, running: 0, machinesAtOnce: 20,
    sessions: 0, byDay, environments: [], repositories: [], machines: [], storage: [],
    spend: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, runs: 0 }, agents: [], costly: [],
  };
}

// Out of credit: credit left reads in red.
// Only tab sessions ran: no machine, the agents' runs alone.
function usageModels(): UsageReport {
  const full = usage();
  const empty = usageEmpty();
  return { ...empty, spend: full.spend, agents: full.agents, costly: full.costly, byDay: empty.byDay.map((d, i) => ({ ...d, spend: full.byDay[i].spend })) };
}

// Cents of a few machine minutes: the axis counts in hundredths.
const usageSmall = (): UsageReport => {
  const full = usage(14);
  const small = (cents: number) => Math.round(cents / 40) / 1;
  return { ...full, byDay: full.byDay.map((d) => ({ ...d, cents: Object.fromEntries(Object.entries(d.cents).map(([id, c]) => [id, small(c)])), spend: small(d.spend ?? 0) })) };
};

const usageTrial = (): UsageReport => ({ ...usage(), creditLeft: 0, trialUntil: ahead(12), trialCents: 1_840 });
const usageSpent = (): UsageReport => ({ ...usage(), creditLeft: -34, spendable: false, running: 0 });

// A workspace with credit from its top-ups.
const billing: BillingAccount = { currency: "EUR", balanceCents: 4_210, spendable: true, unitCents: 1_000, mostUnits: 100, stripeCustomer: true };

// A new workspace: nothing bought yet, no Stripe customer.
const billingEmpty: BillingAccount = { currency: "EUR", balanceCents: 0, spendable: false, unitCents: 1_000, mostUnits: 100, stripeCustomer: false };

// A workspace staff gave a trial: machines run without credit until it ends.
const billingTrial: BillingAccount = { ...billingEmpty, spendable: true, trialUntil: ahead(12) };

const history: CreditLine[] = [
  { createdAt: ago(0), kind: "debit", note: "dummy-rails-k2w8q1, 185 minutes", cents: -128 },
  { createdAt: ago(0), kind: "debit", note: "nvoi-staging-seed, 40 minutes", cents: -55 },
  { createdAt: ago(1), kind: "debit", note: "dummy-rails-k2w8q1, 312 minutes", cents: -216 },
  { createdAt: ago(3), kind: "grant", note: "Top-up, 5 × 10 EUR", cents: 5_000 },
  { createdAt: ago(2), kind: "debit", note: "nvoi-staging-seed, 9 minutes", cents: -6.6 },
  { createdAt: ago(2), kind: "debit", note: "dummy-rails-k2w8q1, 20 minutes", cents: -25 },
  { createdAt: ago(2), kind: "debit", note: "dummy-rails-k2w8q1, 1 minute", cents: -0.4 },
  { createdAt: ago(20), kind: "trial", note: "dummy-rails-k2w8q1, 90 minutes", cents: -62 },
];

const refusals: Record<"noAccount" | "noSeats" | "notOwner" | "lastOwner" | "unauthenticated" | "aboveCeiling", Refusal> = {
  noAccount: { error: "No account with that email.", code: "no_account" },
  noSeats: { error: "A second member needs seats, $15 a member a month. Start seats under Billing, then add them.", code: "seats" },
  notOwner: { error: "Only an owner may change members.", code: "not_an_owner" },
  lastOwner: { error: "The last owner stays.", code: "last_owner" },
  aboveCeiling: { error: "cannot be auto on environment_delete for manager: at most approval", code: "invalid" },
  // `GET /api/v1/whoami` with a destroyed session.
  unauthenticated: { error: "You are not signed in.", code: "unauthenticated" },
};


// A tool's level for each role: the levels the role holds by default, and what it was changed to.
const held = (editor: ToolLevel, manager: ToolLevel, admin: ToolLevel, changed: Partial<Record<"editor" | "manager" | "admin", ToolLevel>> = {}): RoleTool["levels"] => {
  const level = (role: "editor" | "manager" | "admin", fallback: ToolLevel): RoleLevel => ({
    level: changed[role] ?? fallback,
    fallback,
    options: fallback === "deny" ? ["deny"] : fallback === "auto" ? ["auto", "approval", "deny"] : ["approval", "deny"],
  });
  return { editor: level("editor", editor), manager: level("manager", manager), admin: level("admin", admin) };
};

const roleTools: RoleTool[] = [
  { name: "environment_list", summary: "List environments", category: "Environments", levels: held("auto", "auto", "auto") },
  { name: "environment_show", summary: "Show an environment", category: "Environments", levels: held("auto", "auto", "auto") },
  { name: "environment_delete", summary: "Delete an environment", category: "Environments", levels: held("deny", "approval", "approval", { manager: "deny" }) },
  { name: "agent_session_list", summary: "List sessions", category: "Sessions", levels: held("auto", "auto", "auto") },
  { name: "agent_session_start", summary: "Start a session", category: "Sessions", levels: held("approval", "approval", "approval", { editor: "auto" }) },
  { name: "utils_machine_process_stop", summary: "Stop a session's agent", category: "Sessions", levels: held("approval", "approval", "approval") },
  { name: "utils_usage_show", summary: "Show usage", category: "Usage", levels: held("deny", "auto", "auto") },
  { name: "workspace_user_create", summary: "Add a member", category: "Members", levels: held("deny", "deny", "deny") },
];

// What a member holds: the role's levels with the ones set for them.
const memberTools: MemberTool[] = [
  { name: "agent_session_start", summary: "Start a session", category: "Sessions", level: "auto", fallback: "approval", overridden: true, options: ["approval", "deny"], carriedBy: [] },
  {
    name: "utils_machine_process_stop", summary: "Stop a session's agent", category: "Sessions", level: "deny", fallback: "approval", overridden: true, options: ["approval", "deny"],
    carriedBy: [{ agentId: "0191c1a2-2000-7000-8000-000000000001", agentName: "Dev" }],
  },
  { name: "environment_show", summary: "Show an environment", category: "Environments", level: "auto", fallback: "auto", overridden: false, options: ["auto", "approval", "deny"], carriedBy: [] },
  { name: "utils_usage_show", summary: "Show usage", category: "Usage", level: "deny", fallback: "deny", overridden: false, options: ["deny"], carriedBy: [] },
];

export const settingsSamples = {
  roleTools,
  memberTools,
  memberToolsPlain: memberTools.map((t) => ({ ...t, level: t.fallback, overridden: false, carriedBy: [] })),
  you,
  members,
  // One owner alone: the last owner stays, so Remove is off.
  alone: [members[0]],
  ...refusals,
  whoami,
  // A picture from the gallery's sample files.
  whoamiPicture: { ...whoami, user: { ...whoami.user, picture: "/samples/whiteboard.png" } } as WhoamiModel,
  whoamiAlone: { user: whoami.user, workspace: workspaces[0], workspaces: [workspaces[0]] } as WhoamiModel,
  usage,
  usageEmpty,
  usageModels,
  usageSpent,
  usageSmall,
  billing,
  billingEmpty,
  billingTrial,
  usageTrial,
  history,
  failed: "The server did not answer. Check the connection and try again.",
};
