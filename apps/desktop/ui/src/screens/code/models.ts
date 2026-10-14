// Plain models of the code pages (repositories, environments, connectors), shaped as packages/core serves them.
import type { ListState } from "../../lists";
import type { Tone } from "../../tokens";
import { settingsFormat } from "../settings/models";

// An error body as the API sends it: `{ error, code }`. Field errors (`{ errors: { field: [..] } }`) are
// `CodeFieldErrors`.
export type CodeError = { error: string; code: string };

export const codeError = (error: string, code: string): CodeError => ({ error, code });

// `{ errors: { field: [message] } }`, as a 422 on create or update sends it.
export type CodeFieldErrors = Record<string, string[]>;

// What a page shows while the API answers: loading, the error it sent back, or the value.
export type CodeLoad<T> = "loading" | { failed: CodeError } | { loaded: T };

export const codeLoad = {
  value<T>(load: CodeLoad<T>): T | undefined {
    return typeof load === "object" && "loaded" in load ? load.loaded : undefined;
  },
  failure<T>(load: CodeLoad<T>): CodeError | undefined {
    return typeof load === "object" && "failed" in load ? load.failed : undefined;
  },
  // The list page's state; the rows come from `value`.
  list<T>(load: CodeLoad<T>): ListState {
    if (load === "loading") return "loading";
    if ("failed" in load) return { failed: load.failed.error };
    return "loaded";
  },
};

// An environment as a repo lists it (`repos[].environments`).
export type RepoEnvironment = { id: string; name: string; providerName: string };

// A repository (`RepoResource`): `name` is the full name, owner/short.
export type Repo = {
  id: string;
  name: string;
  owner: string;
  defaultBranch?: string;
  githubInstallationId?: string;
  environments: RepoEnvironment[];
  createdAt: string;
};

const last = (name: string) => name.split("/").pop() ?? name;

export const repo = { short: (r: Repo) => last(r.name) };

// A repository a GitHub installation reaches (`github_installations[].repositories`).
export type GithubRepository = { id: string; fullName: string; isPrivate: boolean; pushedAt?: string };

export const githubRepository = { short: (r: GithubRepository) => last(r.fullName) };

// `repos_sync_status`, as `GithubInstallation::STATUSES`.
export type SyncStatus = "idle" | "pending" | "syncing" | "ready" | "failed";

// A GitHub connection (`GithubInstallationResource`): the App installed on an account, or a token.
export type GithubInstallation = {
  id: string;
  // `app` or `token`.
  kind: string;
  accountLogin: string;
  // `User` or `Organization`, as GitHub names it.
  accountType: string;
  suspended: boolean;
  reposSyncStatus: SyncStatus;
  reposSyncedAt?: string;
  repositories: GithubRepository[];
};

export const githubInstallation = {
  // As `GithubInstallation#means`.
  means: (i: GithubInstallation) => (i.kind === "app" ? "GitHub App" : "Personal access token"),
  syncing: (i: GithubInstallation) => i.reposSyncStatus === "pending" || i.reposSyncStatus === "syncing",
};

// A connection (`ConnectorResource`). `state` is `ok`, `busy` or `bad`; `stateWord` says it.
export type Connector = {
  id: string;
  source: string;
  title: string;
  means?: string;
  reach?: string;
  state: string;
  stateWord: string;
  events: string[];
  createdAt: string;
};

// A variable (`environment.vars[]`); a secret's value is undefined.
export type EnvVar = { key: string; value?: string; secret: boolean };

// A command (`environment.commands[]`). `kind` is `setup`, `preview` or `default`; `port` and `before` are for
// preview commands only.
export type EnvCommand = { id: string; kind: string; name: string; command: string; port?: number; before: string[]; position: number };

// `environment.database`: the engine and version named, and whether the vendor has made it.
// `option`: the label of the database option it was picked from (a production environment's).
export type EnvDatabase = { engine: string; version: string; ready: boolean; option?: string };

// A production database on offer (`GET environments/options`, `databases[]`). A Neon option has a CU range and the
// prices of a CU-hour and of a GB-month; a cluster option has its resources and no price (its cost is the cluster's).
export type DatabaseOption = {
  label: string;
  provider: string;
  storageGb: number;
  minCu?: number;
  maxCu?: number;
  cpu?: number;
  memoryGb?: number;
  computePrice?: number;
  storagePrice?: number;
  onRequest: boolean;
  currency: string;
};

// A server option for production environments on offer (`GET environments/options`, `production[]`): `cost` is the
// provider's cents per hour, `price` what the site charges (none when it bills nothing).
export type ProductionOption = { label: string; provider: string; type: string; nodes: number; cost?: number; price?: number; currency: string };

// `environment.health`: what the watcher last saw of a production environment's cluster, with the reasons when not ok.
export type EnvHealth = { status: "ok" | "degraded" | "down"; reasons: string[] };

// An environment (`EnvironmentResource`).
export type EnvironmentDetail = {
  id: string;
  repoId: string;
  name: string;
  providerName: string;
  shape: string;
  disk: number;
  branch: string;
  previewPort?: number;
  manifest?: string;
  // development or production.
  kind?: string;
  database?: EnvDatabase;
  // Only a production environment with a cluster the watcher has read.
  health?: EnvHealth;
  // A production environment's server option, by label; none before its cluster is made.
  option?: string;
  vars: EnvVar[];
  commands: EnvCommand[];
  // Open to every member, or only to the admins and the members `memberIds` names (`environments`: `restricted`,
  // `member_ids`).
  restricted: boolean;
  memberIds: string[];
  createdAt: string;
};

// A member who may be admitted to a restricted environment (`members`): admins reach every environment already.
// `you`: the person looking, who keeps an environment they restrict.
export type AccessMember = { id: string; email: string; name?: string; role: "editor" | "manager" | "admin"; you?: boolean };

export const environmentDetail = {
  // The head's and the list's tag; nothing for a development environment.
  health: (e: EnvironmentDetail): [string, Tone] | undefined =>
    e.health && ({ ok: ["OK", "green"], degraded: ["Degraded", "orange"], down: ["Down", "red"] } as const)[e.health.status] as [string, Tone],
  // A dry run starts the preview, so it needs a preview command.
  previews: (e: EnvironmentDetail) => e.commands.some((c) => c.kind === "preview"),
};

// A disk the provider offers for a size: from `min` to `max` GB, `step` apart.
export type OptionDisk = { min: number; step: number; default: number; max: number };

// A machine size the site offers (`GET environments/options`, `sandbox[]`). `cost` is the provider's cents per hour,
// `price` what the site charges per hour (none when it bills nothing); `disk` is none for a size the provider does
// not list yet, which is `onRequest`.
export type SandboxOption = { label: string; provider: string; cpu: number; memory: number; disk?: OptionDisk; onRequest: boolean; cost: number; price?: number; currency: string };

export const sandboxOption = {
  // The size key the API stores on an environment ("2x4").
  shape: (o: SandboxOption) => `${o.cpu}x${o.memory}`,
  // The option an environment runs on: its provider and size key.
  of: (options: SandboxOption[], provider: string, shape: string) => options.find((o) => o.provider === provider && sandboxOption.shape(o) === shape),
  // The disk sizes to pick from, in GB.
  disks(o: SandboxOption): number[] {
    if (!o.disk) return [];
    const { min, max, step } = o.disk;
    if (step <= 0) return [min];
    const out: number[] = [];
    for (let n = min; n <= max; n += step) out.push(n);
    return out;
  },
};

// A database engine on offer (`GET environments/engines`).
export type DatabaseEngine = { name: string; label: string; versions: string[]; defaultVersion: string };

// The checkout of a session (`session.worktree`). `state` is `new`, `starting`, `running`, `paused` or `failed`.
export type CodeWorktree = { id: string; branch: string; state: string; hostname?: string; serving: boolean };

// A session as `POST repos/{id}/start` and `POST environments/{id}/dry_run` answer it.
export type StartedSession = { id: string; title: string; status: string; environmentId?: string; worktree: CodeWorktree; createdAt: string };

// Where a dry run stands: asked, started (202) or refused (422 `no_preview_command`).
export type DryRun = "starting" | { started: StartedSession } | { refused: CodeError };

export type DraftVar = {
  key: string;
  value: string;
  secret: boolean;
  // The key it was saved under; undefined for a variable added in the form.
  saved?: string;
  // A saved secret: its value is not sent back, and an empty value keeps the saved one.
  hidden?: boolean;
};

export type DraftCommand = {
  // Undefined for a command added in the form.
  id?: string;
  kind: string;
  name: string;
  command: string;
  port: string;
  before: string;
};

// What a save of the environment form sends. The general fields go to `PATCH environments/{id}` (or `POST
// repos/{repo_id}/environments`), each variable to `PUT vars` or `DELETE vars/{key}`, each command to `PUT
// commands` or `DELETE commands/{command_id}`.
export type EnvironmentDraft = {
  repoId: string;
  name: string;
  providerName: string;
  shape: string;
  disk: number;
  branch: string;
  previewPort: string;
  // Undefined for no database.
  databaseEngine?: string;
  databaseVersion?: string;
  // A production environment's database, by the label of its option.
  databaseOption?: string;
  vars: DraftVar[];
  removedVars: string[];
  commands: DraftCommand[];
  removedCommands: string[];
  restricted: boolean;
  memberIds: string[];
};

// A save that went partly through: the general fields were saved, then `failed` (a variable or a command, named for
// running text: "the variable API_KEY") was refused with `error`, and what came after it was not tried. `created`:
// the save made a new environment. `vars` and `commands` are the draft's part that was not saved, the refused one
// first; a created environment's form opens with them filled in.
export type PartialSave = { failed: string; error: CodeError; created?: boolean; vars?: DraftVar[]; commands?: DraftCommand[] };

const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const pad = (n: number) => String(n).padStart(2, "0");

// How the code pages print what the API sends: days, prices, sizes, states.
export const codeFormat = {
  // What a production option gives and costs, on two lines.
  productionOption(o: ProductionOption): string {
    const price = o.price ?? o.cost;
    return `${o.type} · ${o.nodes} ${o.nodes === 1 ? "node" : "nodes"}\n${price !== undefined ? `${settingsFormat.money(price, o.currency)}/h` : ""}`;
  },
  // What a database option gives and costs, on two lines.
  databaseOption(o: DatabaseOption): string {
    if (o.onRequest) return "On request";
    if (o.provider === "cloudnativepg") return `${o.cpu} vCPU · ${o.memoryGb} GB · ${o.storageGb} GB\nOn its cluster`;
    const price =
      o.computePrice !== undefined && o.storagePrice !== undefined
        ? `${settingsFormat.money(o.computePrice, o.currency)}/CU-h · ${settingsFormat.money(o.storagePrice, o.currency)}/GB-month`
        : "";
    return `${o.minCu} to ${o.maxCu} CU · ${o.storageGb} GB\n${price}`;
  },
  // "Sep 30, 2026" from an ISO timestamp; the raw string when it does not parse.
  day(iso?: string): string | undefined {
    if (!iso) return undefined;
    const t = Date.parse(iso);
    return Number.isNaN(t) ? iso : day.format(t);
  },
  // "Sep 30, 16:40" from an ISO timestamp.
  time(iso?: string): string | undefined {
    if (!iso) return undefined;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return iso;
    const d = new Date(t);
    return `${monthDay.format(t)}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  },
  // Cents per hour in the workspace's currency: "€0.17/h".
  rate: (cents: number, currency: string) => `${settingsFormat.money(cents, currency)}/h`,
  // "S · 2 vCPU · 4 GB" for an environment's size, from the option it runs on when the site offers it, else from the key.
  shape(key: string, options: SandboxOption[], provider: string): string {
    const o = sandboxOption.of(options, provider, key);
    if (o) return `${o.label} · ${o.cpu} vCPU · ${o.memory} GB`;
    const p = key.split("x");
    return p.length === 2 ? `${p[0]} vCPU · ${p[1]} GB` : key;
  },
  // "Postgres 18" for a database, from the engines when they name it.
  database(db: EnvDatabase | undefined, engines: DatabaseEngine[]): string | undefined {
    if (!db) return undefined;
    const label = engines.find((e) => e.name === db.engine)?.label ?? db.engine;
    return db.version === "libsql" ? label : `${label} ${db.version}`;
  },
  // "Private · pushed Sep 30, 2026".
  pushed: (r: GithubRepository) => [r.isPrivate ? "Private" : "Public", codeFormat.day(r.pushedAt) && `pushed ${codeFormat.day(r.pushedAt)}`].filter(Boolean).join(" · "),
};
