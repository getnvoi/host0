// Fixtures for the gallery, shaped as `packages/core` serves them (openapi.yaml and app/resources).
import {
  codeError, githubInstallation, type AccessMember, type CodeFieldErrors, type Connector, type DatabaseEngine, type DatabaseOption, type EnvironmentDetail, type GithubInstallation,
  type GithubRepository, type PartialSave, type Repo, type StartedSession, type SyncStatus, type OptionDisk, type ProductionOption, type SandboxOption,
} from "./models";

const githubEvents = ["pull_request", "issues", "issue_comment", "pull_request_review", "push"];

const benRepositories: GithubRepository[] = [
  { id: "5b1f0c2e-41aa-4c55-9d36-0d1a8f3e7a01", fullName: "benbonnet/dotfiles", isPrivate: false, pushedAt: "2026-08-14T19:02:11.000Z" },
  { id: "5b1f0c2e-41aa-4c55-9d36-0d1a8f3e7a02", fullName: "benbonnet/dummy-rails", isPrivate: true, pushedAt: "2026-09-30T16:40:03.000Z" },
  { id: "5b1f0c2e-41aa-4c55-9d36-0d1a8f3e7a03", fullName: "benbonnet/notes", isPrivate: true, pushedAt: "2026-07-02T08:15:47.000Z" },
];

const northwindRepositories: GithubRepository[] = [
  { id: "7c2e9a10-1b3d-4f6e-8a9b-2c4d6e8f0a11", fullName: "northwind/billing", isPrivate: true, pushedAt: "2026-09-29T11:20:00.000Z" },
  { id: "7c2e9a10-1b3d-4f6e-8a9b-2c4d6e8f0a12", fullName: "northwind/infra", isPrivate: true, pushedAt: "2026-09-12T09:05:31.000Z" },
  { id: "7c2e9a10-1b3d-4f6e-8a9b-2c4d6e8f0a13", fullName: "northwind/web", isPrivate: true, pushedAt: "2026-10-01T07:58:12.000Z" },
  { id: "7c2e9a10-1b3d-4f6e-8a9b-2c4d6e8f0a14", fullName: "northwind/site", isPrivate: false, pushedAt: "2026-09-21T14:44:09.000Z" },
];

const ben: GithubInstallation = {
  id: "a3d9e0f1-2b4c-4d5e-9f60-718293a4b5c1", kind: "app", accountLogin: "benbonnet", accountType: "User", suspended: false,
  reposSyncStatus: "ready", reposSyncedAt: "2026-10-01T08:12:40.000Z", repositories: benRepositories,
};

const northwind: GithubInstallation = {
  id: "a3d9e0f1-2b4c-4d5e-9f60-718293a4b5c2", kind: "app", accountLogin: "northwind", accountType: "Organization", suspended: false,
  reposSyncStatus: "ready", reposSyncedAt: "2026-10-01T07:59:02.000Z", repositories: northwindRepositories,
};

// A token pasted for an account whose last read failed.
const acme: GithubInstallation = {
  id: "a3d9e0f1-2b4c-4d5e-9f60-718293a4b5c3", kind: "token", accountLogin: "acme", accountType: "Organization", suspended: false,
  reposSyncStatus: "failed", reposSyncedAt: "2026-09-27T17:30:00.000Z",
  repositories: [{ id: "9e8d7c6b-5a49-4382-a1b0-c9d8e7f6a5b1", fullName: "acme/site", isPrivate: false, pushedAt: "2026-09-26T10:00:00.000Z" }],
};

// An installation in another `repos_sync_status`, or suspended. Never read (`idle`), it holds nothing yet.
function variant(i: GithubInstallation, status: SyncStatus, suspended = false): GithubInstallation {
  return {
    ...i, suspended, reposSyncStatus: status,
    reposSyncedAt: status === "idle" ? undefined : i.reposSyncedAt,
    repositories: status === "idle" ? [] : i.repositories,
  };
}

// As `ConnectorResource` renders an installation: its title, means, reach and state.
function connector(i: GithubInstallation): Connector {
  const [state, word] = i.suspended
    ? ["bad", "Suspended on GitHub"]
    : githubInstallation.syncing(i)
      ? ["busy", "Reading repositories"]
      : i.reposSyncStatus === "failed"
        ? ["bad", "Last read failed"]
        : ["ok", "Connected"];
  const n = i.repositories.length;
  return {
    id: i.id, source: "github", title: i.accountLogin, means: githubInstallation.means(i), reach: `${n} ${n === 1 ? "repository" : "repositories"}`,
    state, stateWord: word, events: githubEvents, createdAt: "2026-02-03T10:00:00.000Z",
  };
}

const dummyRails: Repo = {
  id: "1f0e2d3c-4b5a-4968-8776-655443322101", name: "benbonnet/dummy-rails", owner: "benbonnet", defaultBranch: "main", githubInstallationId: ben.id,
  environments: [
    { id: "e1000000-0000-4000-8000-000000000001", name: "development", providerName: "daytona" },
    { id: "e1000000-0000-4000-8000-000000000002", name: "staging", providerName: "daytona" },
  ],
  createdAt: "2026-02-03T10:04:00.000Z",
};

const web: Repo = {
  id: "1f0e2d3c-4b5a-4968-8776-655443322102", name: "northwind/web", owner: "northwind", defaultBranch: "main", githubInstallationId: northwind.id,
  environments: [
    { id: "e1000000-0000-4000-8000-000000000003", name: "development", providerName: "daytona" },
    { id: "e1000000-0000-4000-8000-000000000004", name: "preview", providerName: "daytona" },
  ],
  createdAt: "2026-03-11T15:20:00.000Z",
};

const billing: Repo = {
  id: "1f0e2d3c-4b5a-4968-8776-655443322103", name: "northwind/billing", owner: "northwind", defaultBranch: "trunk", githubInstallationId: northwind.id,
  environments: [{ id: "e1000000-0000-4000-8000-000000000005", name: "development", providerName: "daytona" }],
  createdAt: "2026-05-27T09:41:00.000Z",
};

// Imported through a connection since removed: the repo stays, its installation id is gone.
const infra: Repo = {
  id: "1f0e2d3c-4b5a-4968-8776-655443322104", name: "northwind/infra", owner: "northwind", environments: [], createdAt: "2026-06-30T12:00:00.000Z",
};

const disk: OptionDisk = { min: 10, step: 5, default: 10, max: 15 };

// What `GET environments/options` answers for northwind.example.com's sandbox: the sizes the provider lists, then those on request.
const small: SandboxOption = { label: "S", provider: "daytona", cpu: 2, memory: 4, disk, onRequest: false, cost: 16.668, price: 41.67, currency: "EUR" };
const medium: SandboxOption = { label: "M", provider: "daytona", cpu: 4, memory: 8, disk, onRequest: false, cost: 33.228, price: 83.07, currency: "EUR" };
const large: SandboxOption = { label: "L", provider: "daytona", cpu: 8, memory: 16, onRequest: true, cost: 66.348, price: 165.87, currency: "EUR" };
const extraLarge: SandboxOption = { label: "XL", provider: "daytona", cpu: 16, memory: 32, onRequest: true, cost: 132.588, price: 331.47, currency: "EUR" };
const options: SandboxOption[] = [small, medium, large, extraLarge];
// A site that bills nothing: no price.
const optionsUnpriced: SandboxOption[] = options.map((o) => ({ ...o, price: undefined }));

const engines: DatabaseEngine[] = [
  { name: "postgres", label: "Postgres", versions: ["14", "15", "16", "17", "18"], defaultVersion: "18" },
  { name: "sqlite", label: "SQLite", versions: ["libsql"], defaultVersion: "libsql" },
];

const databaseOptions: DatabaseOption[] = [
  { label: "S", provider: "neon", minCu: 0.25, maxCu: 1, storageGb: 10, computePrice: 15.9, storagePrice: 52.5, onRequest: false, currency: "EUR" },
  { label: "M", provider: "neon", minCu: 0.5, maxCu: 2, storageGb: 50, computePrice: 15.9, storagePrice: 52.5, onRequest: false, currency: "EUR" },
  { label: "L", provider: "neon", minCu: 1, maxCu: 4, storageGb: 200, onRequest: true, currency: "EUR" },
  { label: "On the cluster", provider: "cloudnativepg", cpu: 1, memoryGb: 2, storageGb: 20, onRequest: false, currency: "EUR" },
];

// What `GET environments/options` answers for northwind.example.com's production servers, in the workspace's currency.
const productionOptions: ProductionOption[] = [
  { label: "S", provider: "hetzner", type: "cax21", nodes: 1, cost: 1.04, price: 2.6, currency: "EUR" },
  { label: "M", provider: "hetzner", type: "cax31", nodes: 1, cost: 2.08, price: 5.2, currency: "EUR" },
  { label: "L", provider: "hetzner", type: "cax41", nodes: 1, cost: 4.16, price: 10.4, currency: "EUR" },
];

const development: EnvironmentDetail = {
  id: "e1000000-0000-4000-8000-000000000001", repoId: dummyRails.id, name: "development", providerName: "daytona", shape: "2x4", disk: 10,
  branch: "main", previewPort: 3000, database: { engine: "postgres", version: "18", ready: true },
  vars: [
    { key: "RAILS_ENV", value: "development", secret: false },
    { key: "RAILS_MASTER_KEY", secret: true },
    { key: "STRIPE_SECRET_KEY", secret: true },
  ],
  commands: [
    { id: "c1000000-0000-4000-8000-000000000001", kind: "setup", name: "ruby", command: "mise use -g ruby@3.4.1", before: [], position: 0 },
    { id: "c1000000-0000-4000-8000-000000000002", kind: "setup", name: "install", command: "bundle install", before: [], position: 1 },
    { id: "c1000000-0000-4000-8000-000000000003", kind: "preview", name: "web", command: "bin/rails server -p 3000", port: 3000, before: ["bin/rails db:prepare"], position: 0 },
    { id: "c1000000-0000-4000-8000-000000000004", kind: "default", name: "test", command: "bin/rails test", before: [], position: 0 },
  ],
  restricted: false, memberIds: [],
  createdAt: "2026-02-03T10:04:00.000Z",
};

const staging: EnvironmentDetail = {
  id: "e1000000-0000-4000-8000-000000000002", repoId: dummyRails.id, name: "staging", providerName: "daytona", shape: "4x8", disk: 15,
  branch: "staging", previewPort: 3000, database: { engine: "postgres", version: "17", ready: false },
  vars: [{ key: "RAILS_ENV", value: "staging", secret: false }, { key: "SENTRY_DSN", secret: true }],
  commands: [
    { id: "c1000000-0000-4000-8000-000000000005", kind: "setup", name: "install", command: "bundle install", before: [], position: 0 },
    { id: "c1000000-0000-4000-8000-000000000006", kind: "preview", name: "web", command: "bin/rails server -p 3000", port: 3000, before: [], position: 0 },
    { id: "c1000000-0000-4000-8000-000000000007", kind: "preview", name: "jobs", command: "bin/jobs", before: [], position: 1 },
  ],
  restricted: false, memberIds: [],
  createdAt: "2026-04-18T08:30:00.000Z",
};

// On a size the site no longer offers (`e2b` while only Daytona's are listed).
const retired: EnvironmentDetail = {
  id: "e1000000-0000-4000-8000-000000000009", repoId: dummyRails.id, name: "load-test", providerName: "e2b", shape: "4x8", disk: 20,
  branch: "main", previewPort: 3000, vars: [], commands: [], restricted: false, memberIds: [], createdAt: "2026-03-11T09:00:00.000Z",
};

// The general fields saved, then a variable refused.
const partial: PartialSave = {
  failed: "the variable app_host",
  error: codeError("Key must be upper-case letters, digits and underscores.", "invalid"),
};

// A new environment created, then a variable refused: the rest of the draft carried to its page.
const partialCreated: PartialSave = {
  ...partial,
  created: true,
  vars: [
    { key: "app_host", value: "review.dummy-rails.dev", secret: false },
    { key: "RAILS_ENV", value: "development", secret: false },
  ],
  commands: [
    { kind: "setup", name: "install", command: "bin/setup", port: "", before: "" },
    { kind: "preview", name: "web", command: "bin/rails server -p 3000", port: "3000", before: "" },
  ],
};

// Just created: the general fields only.
const created: EnvironmentDetail = {
  id: "e1000000-0000-4000-8000-000000000010", repoId: dummyRails.id, name: "review", providerName: "daytona", shape: "2x4", disk: 10,
  branch: "main", previewPort: 3000, vars: [], commands: [], restricted: false, memberIds: [], createdAt: "2026-10-01T09:00:00.000Z",
};

const webDevelopment: EnvironmentDetail = {
  id: "e1000000-0000-4000-8000-000000000003", repoId: web.id, name: "development", providerName: "daytona", shape: "8x16", disk: 15,
  branch: "main", previewPort: 3000, manifest: "h0.yml", database: { engine: "postgres", version: "18", ready: true },
  vars: [{ key: "POSTGRES_HOST", value: "$PGHOST", secret: false }],
  commands: [
    { id: "c1000000-0000-4000-8000-000000000008", kind: "setup", name: "install", command: "bin/setup --skip-server", before: [], position: 0 },
    { id: "c1000000-0000-4000-8000-000000000009", kind: "preview", name: "web", command: "bin/dev", port: 3000, before: [], position: 0 },
  ],
  restricted: false, memberIds: [],
  createdAt: "2026-03-11T15:20:00.000Z",
};

// No preview command: a dry run is refused.
const webPreview: EnvironmentDetail = {
  id: "e1000000-0000-4000-8000-000000000004", repoId: web.id, name: "preview", providerName: "daytona", shape: "2x4", disk: 10,
  branch: "main", vars: [],
  commands: [{ id: "c1000000-0000-4000-8000-000000000010", kind: "setup", name: "install", command: "bin/setup", before: [], position: 0 }],
  restricted: false, memberIds: [],
  createdAt: "2026-07-08T13:00:00.000Z",
};

const billingDevelopment: EnvironmentDetail = {
  id: "e1000000-0000-4000-8000-000000000005", repoId: billing.id, name: "development", providerName: "daytona", shape: "2x4", disk: 10,
  branch: "trunk", previewPort: 5173, database: { engine: "sqlite", version: "libsql", ready: true },
  vars: [{ key: "STRIPE_TEST_KEY", secret: true }],
  commands: [
    { id: "c1000000-0000-4000-8000-000000000011", kind: "setup", name: "install", command: "pnpm install", before: [], position: 0 },
    { id: "c1000000-0000-4000-8000-000000000012", kind: "preview", name: "web", command: "pnpm dev", port: 5173, before: [], position: 0 },
  ],
  restricted: false, memberIds: [],
  createdAt: "2026-05-27T09:41:00.000Z",
};

// 202 of `POST environments/{id}/dry_run`.
const started: StartedSession = {
  id: "5e550000-0000-4000-8000-000000000001", title: "Untitled", status: "idle", environmentId: development.id,
  worktree: { id: "3a770000-0000-4000-8000-000000000001", branch: "dummy-rails-4f2a91", state: "new", serving: false },
  createdAt: "2026-10-01T09:14:00.000Z",
};

const fieldErrors: CodeFieldErrors = {
  name: ["has already been taken"],
  preview_port: ["must be in 1..65535"],
  database: ["postgres:99 is not offered. postgres comes in 14, 15, 16, 17, 18."],
};

// The workspace's members, as the environment form's Access tab lists them.
const accessMembers: AccessMember[] = [
  { id: "a1000000-0000-4000-8000-000000000001", email: "ben@dee.mx", name: "Ben Bonnet", role: "admin" },
  { id: "a1000000-0000-4000-8000-000000000002", email: "ana@northwind.dev", role: "manager", you: true },
  { id: "a1000000-0000-4000-8000-000000000003", email: "tom@northwind.dev", role: "editor" },
  { id: "a1000000-0000-4000-8000-000000000004", email: "lea@northwind.dev", role: "editor" },
];

// An environment only some members reach.
const production: EnvironmentDetail = { ...development, id: "e1000000-0000-4000-8000-000000000009", name: "production", kind: "production", previewPort: undefined, commands: [], vars: [], option: "S", database: { engine: "postgres", version: "18", ready: false, option: "S" } };
// Production environments as the watcher last saw them.
const productionOk: EnvironmentDetail = { ...production, id: "e1000000-0000-4000-8000-000000000091", health: { status: "ok", reasons: [] } };
const productionDegraded: EnvironmentDetail = { ...productionOk, health: { status: "degraded", reasons: ["web: CrashLoopBackOff", "web: 1 of 2 replicas ready"] } };
const productionDown: EnvironmentDetail = { ...productionOk, health: { status: "down", reasons: ["no node is ready"] } };

const restrictedDevelopment: EnvironmentDetail = { ...development, restricted: true, memberIds: [accessMembers[1].id] };

export const codeSamples = {
  members: accessMembers, restrictedDevelopment, production, productionOk, productionDegraded, productionDown,
  benRepositories, northwindRepositories, ben, northwind, acme, installations: [ben, northwind, acme], variant, connector,
  connectors: [connector(acme), connector(ben), connector(variant(northwind, "syncing"))],
  dummyRails, web, billing, infra, repos: [dummyRails, billing, infra, web],
  options, optionsUnpriced, engines, databaseOptions, productionOptions,
  development, staging, retired, partial, partialCreated, created, webDevelopment, webPreview, billingDevelopment,
  environments: [development, staging, billingDevelopment, webDevelopment, webPreview],
  started,
  noPreview: codeError("Add a preview command first.", "no_preview_command"),
  // 422 of `PATCH environments/{id}` changing the size while checkouts run.
  checkouts: codeError("2 checkouts run on it. Delete them to change the option, disk, branch or database.", "checkouts"),
  notFound: codeError("That does not exist.", "not_found"),
  notVisible: codeError("acme/site is no longer visible to that token.", "repository_not_visible"),
  promptMissing: codeError("prompt is required", "parameter_missing"),
  unreachable: codeError("The API could not be reached.", "offline"),
  fieldErrors,
};
