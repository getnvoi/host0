// The settings pages' values: members, the account, usage and billing, as the API serves them, and how the web
// pages write money, dates and machine time.
import type { ListState } from "../../lists";

// What a page shows while its data comes from the API: loading, a failure's message, or the data.
export type Remote<T> = "loading" | { failed: string } | { loaded: T };

export const remote = {
  loaded: <T>(value: T): Remote<T> => ({ loaded: value }),
  failed: <T>(message: string): Remote<T> => ({ failed: message }),
  value: <T>(r: Remote<T>): T | undefined => (typeof r === "object" && "loaded" in r ? r.loaded : undefined),
  // The list page's state; the rows come from the value.
  list: <T>(r: Remote<T>): ListState => (r === "loading" ? "loading" : "failed" in r ? { failed: r.failed } : "loaded"),
};

// An API refusal: `{ error, code }`, as every `/api/v1` endpoint answers one.
export type Refusal = { error: string; code: string };

// `WorkspaceUser.role`, with the names and details of the web form (`MembersController::ROLES`).
export type MemberRole = "editor" | "manager" | "admin";

export const memberRoles: { role: MemberRole; name: string; details: string }[] = [
  { role: "editor", name: "Editor", details: "Starts sessions and works in them." },
  { role: "manager", name: "Manager", details: "The same, decides gates and sets up agents." },
  { role: "admin", name: "Admin", details: "The same, and manages members and billing." },
];

export const roleName = (role: MemberRole) => memberRoles.find((r) => r.role === role)!.name;
export const roleDetails = (role: MemberRole) => memberRoles.find((r) => r.role === role)!.details;

// A member as `GET /api/v1/members` serves it (`MemberResource`).
// `picture`: where their avatar is served, when they chose one.
export type Member = { id: string; userId: string; email: string; role: MemberRole; createdAt: Date; picture?: string };

// The avatar's letter: the web list tiles a member by email.
export const initial = (email: string) => email.slice(0, 1).toUpperCase();

// The new member dialog as it opens: what is typed, whether `POST /api/v1/members` is on its way, what it refused.
export type MemberDraft = { email: string; role: MemberRole; sending: boolean; failure?: Refusal };

export const memberDraft = (d: Partial<MemberDraft> = {}): MemberDraft => ({ email: "", role: "editor", sending: false, ...d });

// `GET /api/v1/whoami`: the account, the workspace the token is pinned to, every workspace of the account.
export type WhoamiModel = {
  // `name` is how the team sees them (the names they gave, else their login); `picture` their avatar's address.
  user: { id: string; email: string; createdAt: Date; firstName?: string; lastName?: string; name?: string; picture?: string };
  workspace: { id: string; name: string; slug: string };
  workspaces: { id: string; name: string; slug: string }[];
};

// An environment as the usage page names it: repository and environment, its machine's shape.
export type UsageEnvironment = { id: string; name: string; repo: string; shape: string };

export const repoShort = (repo: string) => repo.split("/").pop() ?? "";

// `Usage::Day`: cents by environment id ("" for machines whose owner is gone), machine hours by state, and what the
// agents' runs cost that day (`spend_cents`).
export type UsageDay = { date: Date; cents: Record<string, number>; running: number; paused: number; spend?: number };

// `Usage::Spend`: what the agents' runs consumed, paid to the model provider, not from credit. Cents at the model's
// API prices, undefined when no runner stated one.
export type UsageSpend = { cents?: number; input: number; output: number; cacheRead: number; cacheWrite: number; runs: number };

export const spendTokens = (s: UsageSpend) => s.input + s.output + s.cacheRead + s.cacheWrite;

// `Usage::Agent`: an agent's spend and the sessions it ran in; no agent for sessions with none.
export type UsageAgent = { agent?: { id: string; name: string }; sessions: number; spend: UsageSpend };

// `Usage::Session`: a session whose runs cost the most, its sub-sessions counted under it.
export type UsageCostly = { session: { id: string; title: string; hidden?: boolean }; agent?: string; spend: UsageSpend };

// `Usage::Line`: an environment's cents, the part its setup machine cost, the sessions started on it.
export type UsageLine = { environment?: UsageEnvironment; cents: number; setup: number; sessions: number };

// `Usage::Share`: a repository's cents and how many environments spent them.
export type UsageShare = { repo: string; cents: number; environments: number };

// `Usage::Machine`: a session's checkout (its branch, the session on it) or an environment's setup machine.
export type UsageMachine = {
  setup: boolean;
  branch?: string;
  environment: UsageEnvironment;
  session?: { id: string; title: string; hidden?: boolean };
  cents: number;
  running: number;
};

// `Usage::Storage`: what a category of stored bytes cost over the range and its bytes on the last day. `category` is
// images, library, artifacts or repositories; an environment only for images.
export type UsageStorage = { category: string; environment?: UsageEnvironment; bytes: number; cents: number };

// The usage page, as `GET /usage` serves it. Cents are what credit counts; hours are machine time.
export type UsageReport = {
  days: number;
  // `Usage::RANGES`, as the API serves them.
  ranges: number[];
  from: Date;
  to: Date;
  // The workspace's currency (ISO code): every amount of the report is in it.
  currency: string;
  cents: number;
  creditLeft: number;
  spendable: boolean;
  // `trial_until`: staff gave the workspace a trial; machines need no credit until then.
  trialUntil?: Date;
  // `trial_cents.total`: what the trial covered over these days, in the workspace's currency.
  trialCents?: number;
  running: number;
  // None when the site sets no limit.
  machinesAtOnce?: number;
  sessions: number;
  byDay: UsageDay[];
  environments: UsageLine[];
  repositories: UsageShare[];
  machines: UsageMachine[];
  storage: UsageStorage[];
  spend: UsageSpend;
  agents: UsageAgent[];
  costly: UsageCostly[];
};

// The key of a day's cents for an environment; machines whose owner is gone count under "".
export const envKey = (e?: UsageEnvironment) => e?.id ?? "";

// The billing page, as `GET /billing` serves it. Cents are what credit counts.
export type BillingAccount = {
  // The workspace's currency (ISO code): every amount of the page is in it.
  currency: string;
  // `balance_cents`: the wallet, top-ups less what machines drew.
  balanceCents: number;
  spendable: boolean;
  // `trial_until`: staff gave the workspace a trial; machines need no credit until then.
  trialUntil?: Date;
  // `top_up`: one unit's cents, and the most units a checkout sells.
  unitCents: number;
  mostUnits: number;
  // `portal`: Stripe's portal has the invoices.
  stripeCustomer: boolean;
};

// A line of the credit history: a top-up, a machine's running time by day, or a trial's cost (not drawn).
export type CreditLine = { createdAt: Date; kind: string; note?: string; cents: number };

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// How the web pages write money, dates and machine time, so the client reads the same.
export const settingsFormat = {
  // Two places in the workspace's currency (`currency` of the API's answers). Under one cent it reads "< €0.01"
  // ("> -€0.01" when negative); zero reads "€0.00".
  money(cents: number, currency: string): string {
    const write = (units: number) => units.toLocaleString("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (cents !== 0 && Math.abs(cents) < 1) return cents > 0 ? `< ${write(0.01)}` : `> ${write(-0.01)}`;
    return write(cents / 100);
  },

  // Token counts: as they are under a thousand, then k and M.
  tokens(count: number): string {
    if (count < 1000) return `${count}`;
    if (count < 1_000_000) return `${(count / 1000).toLocaleString("en-US", { maximumFractionDigits: count < 10_000 ? 1 : 0 })}k`;
    return `${(count / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: count < 10_000_000 ? 1 : 0 })}M`;
  },

  // Stored bytes in the largest unit under a thousand: B, KB, MB, GB, TB.
  bytes(count: number): string {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = count;
    let unit = 0;
    while (value >= 1000 && unit < units.length - 1) {
      value /= 1000;
      unit += 1;
    }
    return `${value.toLocaleString("en-US", { maximumFractionDigits: unit === 0 || value >= 100 ? 0 : 1 })} ${units[unit]}`;
  },

  // `UsageHelper#usage_time`: minutes under an hour, then hours.
  time(hours: number): string {
    if (hours === 0) return "0 min";
    if (hours < 1) return `${Math.max(Math.round(hours * 60), 1)} min`;
    return `${hours.toLocaleString("en-US", { maximumFractionDigits: hours < 10 ? 1 : 0 })} h`;
  },

  // Oct 7.
  short: (d: Date) => `${months[d.getMonth()]} ${d.getDate()}`,
  // October 7, 2026.
  long: (d: Date) => `${monthNames[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`,
  day: (d: Date) => `${d.getDate()}`,

  // `time_ago_in_words … ago`, in the largest whole unit.
  ago(d: Date, now = new Date()): string {
    const words = new Intl.RelativeTimeFormat("en-US", { numeric: "always" });
    let monthsAgo = (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth();
    if (now.getDate() < d.getDate()) monthsAgo -= 1;
    if (monthsAgo >= 12) return words.format(-Math.floor(monthsAgo / 12), "year");
    if (monthsAgo >= 1) return words.format(-monthsAgo, "month");
    const seconds = Math.max(0, (now.getTime() - d.getTime()) / 1000);
    const days = Math.floor(seconds / 86_400);
    if (days >= 7) return words.format(-Math.floor(days / 7), "week");
    if (days >= 1) return words.format(-days, "day");
    if (seconds >= 3600) return words.format(-Math.floor(seconds / 3600), "hour");
    if (seconds >= 60) return words.format(-Math.floor(seconds / 60), "minute");
    return words.format(-Math.floor(seconds), "second");
  },

  // `ReposHelper::SIZES`.
  size: (shape: string) => ({ "2x4": "S", "4x8": "M", "8x16": "L", "16x32": "XL" })[shape] ?? shape,

  // A chart's top and its gridlines: four steps of 1, 2, 5 or 10 times a power of ten that cover `peak`, none
  // under `least` (a money axis stops at one cent).
  scale(peak: number, least = 0): { top: number; ticks: number[] } {
    if (peak <= 0) return { top: 4, ticks: [0, 1, 2, 3, 4] };
    const raw = Math.max(peak / 4, least);
    const power = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw - 1e-12) ?? raw;
    const round = (v: number) => Number(v.toFixed(10));
    return { top: round(step * 4), ticks: [0, 1, 2, 3, 4].map((i) => round(i * step)) };
  },
};

// What a tool may do when an agent calls it for a person: run at once, ask first, or never (`Tools::LEVELS`).
export type ToolLevel = "auto" | "approval" | "deny";

export const toolLevelName: Record<ToolLevel, string> = { auto: "Auto", approval: "Approval", deny: "Deny" };

// The levels a menu lists, loosest first.
export const toolLevelOrder: ToolLevel[] = ["auto", "approval", "deny"];

// The names of the levels that may be set, in the menu's order.
export const toolLevelNames = (options: ToolLevel[]): string[] => toolLevelOrder.filter((l) => options.includes(l)).map((l) => toolLevelName[l]);

// A role's level for a tool: what it is now, what the role holds by default, the levels that may be set.
export type RoleLevel = { level: ToolLevel; fallback: ToolLevel; options: ToolLevel[] };

// A tool a role may use, as `GET /api/v1/roles` serves it: one level per role.
export type RoleTool = { name: string; summary: string; category: string; levels: Record<MemberRole, RoleLevel> };

// Where a worker agent also carries a tool a member was denied (`also_via`): a warning, never enforced.
export type ToolCarrier = { agentId: string; agentName: string };

// A tool for one member, as `GET /api/v1/members/:id/tool_grants` serves it: the level they hold, the role's level, whether
// it was set for them, the levels that may be set.
export type MemberTool = {
  name: string;
  summary: string;
  category: string;
  level: ToolLevel;
  fallback: ToolLevel;
  overridden: boolean;
  options: ToolLevel[];
  carriedBy: ToolCarrier[];
};

// A level as the API takes it on write: a level, or the role's own (`default`).
export type ToolSetting = ToolLevel | "default";

export const toolLevelOf = (name: string): ToolLevel => toolLevelOrder.find((l) => toolLevelName[l] === name) ?? "deny";
