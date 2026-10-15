// Plain values the agents pages take: agents, skills, workflows, tasks, model credentials. The app adapts the API's
// records to them.
import type { Tone } from "../../tokens";

// What a page waits on: still loading, failed with what the API said, or ready.
export type Fetched<T> = "loading" | { failed: string } | { ready: T };

export const fetched = {
  value: <T>(l: Fetched<T>): T | undefined => (typeof l === "object" && "ready" in l ? l.ready : undefined),
  failed: <T>(l: Fetched<T>): string | undefined => (typeof l === "object" && "failed" in l ? l.failed : undefined),
  // The list page's state; the rows come from the value.
  list: <T>(l: Fetched<T>) => (l === "loading" ? ("loading" as const) : "failed" in l ? { failed: l.failed } : ("loaded" as const)),
};

// The elements whose name holds the query, ignoring case; all of them for an empty query.
export function matching<T>(items: T[], query: string, name: (item: T) => string) {
  const q = query.trim().toLowerCase();
  return q ? items.filter((i) => name(i).toLowerCase().includes(q)) : items;
}

// A model a credential's provider offers (`llm/providers` → `models`), or a select's option.
export type ModelOption = { id: string; label: string };

// How a granted tool runs: at once, or after a person approves the call. A tool not granted does not exist for the agent.
export type GrantLevel = "auto" | "approval";

// One of the tools an agent may be granted (`agents/tools`), in its category. `asks` tools have no auto level;
// `outbound` tools send data out; `level` is the one a grant at `default` picks.
export type AgentToolModel = { name: string; label: string; category: string; asks: boolean; outbound: boolean; level: GrantLevel };

// The categories of a list of tools, in the order they come.
export const toolCategories = (tools: AgentToolModel[]) => [...new Set(tools.map((t) => t.category))];

// The levels a tool may be granted at.
export const toolLevels = (t: AgentToolModel): GrantLevel[] => (t.asks ? ["approval"] : ["auto", "approval"]);

// An agent (`agents`): name, slug, tagline, model, instructions, the tools it is granted, its skills.
export type AgentModel = {
  id: string;
  name: string;
  slug: string;
  tagline?: string;
  // A provider model's id; none for the credential's default.
  model?: string;
  // The model credential its new sessions run on (`llm_config_id`); none for the workspace's main one.
  llmConfigId?: string;
  instructions: string;
  // The tools it is granted, by name; a tool absent here is not one of its tools.
  tools: Record<string, GrantLevel>;
  // `AgentResource#locked`: what always waits on a person whatever the levels say, by category, at its one level.
  locked: LockedTools[];
  // `AgentResource#unenforceable`: the built-in levels the agent's runner cannot enforce, each with why.
  unenforceable: Unenforceable[];
  // `AgentResource#absent`: the built-ins its runner lacks, which are no tool of the agent.
  absent: string[];
  archived: boolean;
  skillIds: string[];
  createdAt: string;
};

export type Unenforceable = { tool: string; level: string; reason: string };

export type LockedTools = { category: string; tools: string[]; level: string };

export function agentModel(a: Partial<AgentModel> & { id: string; name: string }): AgentModel {
  return { slug: "", instructions: "", tools: {}, locked: [], unenforceable: [], absent: [], archived: false, skillIds: [], createdAt: "", ...a };
}

export const agentModels = {
  // The level the agent holds the tool at; none when it is not granted.
  level(a: AgentModel, t: AgentToolModel): GrantLevel | undefined {
    const level = a.tools[t.name];
    return level && t.asks ? "approval" : level;
  },
  // The level a grant at `default` gives: the tool's own.
  grant: (t: AgentToolModel): GrantLevel => (t.asks ? "approval" : t.level),
  // Why the agent's runner cannot enforce this tool at this level, if it cannot.
  refusal: (a: AgentModel, tool: string, level: string) => a.unenforceable.find((u) => u.tool === tool && u.level === level)?.reason,
  // How many of the tools the agent is granted.
  granted: (a: AgentModel, tools: AgentToolModel[]) => tools.filter((t) => agentModels.level(a, t)).length,
  // Outbound tools at auto, as `Agent#unguarded`.
  unguarded: (a: AgentModel, tools: AgentToolModel[]) => tools.filter((t) => t.outbound && agentModels.level(a, t) === "auto"),
};

// A file staged beside a skill's SKILL.md (`skills` → `files`).
export type SkillFileModel = { id: string; path: string; position: number };

// A skill (`skills`): what it is called, when to use it (description), what to do (body), its files.
export type SkillModel = {
  id: string;
  name: string;
  slug: string;
  tagline?: string;
  description?: string;
  example?: string;
  body: string;
  // `custom` or `default`.
  source: string;
  readOnly: boolean;
  archived: boolean;
  files: SkillFileModel[];
  createdAt: string;
};

export function skillModel(s: Partial<SkillModel> & { id: string; name: string }): SkillModel {
  return { slug: "", body: "", source: "custom", readOnly: false, archived: false, files: [], createdAt: "", ...s };
}

// An environment a task or workflow runs on: its id (`environment_id`), name and repository.
export type PlaceModel = { id: string; name: string; repository: string };

export const placeModel = {
  short: (p: PlaceModel) => p.repository.split("/").pop() ?? "",
  label: (p: PlaceModel) => `${placeModel.short(p)} · ${p.name}`,
};

// A task (`tasks`): a session started on a cron schedule, a webhook call or a connector's event.
export type TaskModel = {
  id: string;
  name: string;
  prompt: string;
  // `cron`, `webhook` or `connector`.
  trigger: string;
  // The connector's key for a connector trigger.
  source?: string;
  environmentId: string;
  agentId: string;
  workflowId?: string;
  cron?: string;
  timezone: string;
  // As the task's zone shows it.
  nextRunAt?: string;
  event?: string;
  actions: string[];
  filters: Record<string, string>;
  paused: boolean;
  archived: boolean;
  lastRunAt?: string;
  lastError?: string;
  createdAt: string;
};

export function taskModel(t: Partial<TaskModel> & { id: string; name: string; environmentId: string; agentId: string }): TaskModel {
  return { prompt: "", trigger: "cron", timezone: "UTC", actions: [], filters: {}, paused: false, archived: false, createdAt: "", ...t };
}

// What a connector lets a task listen for, as `GET connectors/definitions` serves it; `github` below is the sample.
export type ConnectorEvent = { key: string; name: string; details: string; actions: string[] };
export type ConnectorFilter = { key: string; label: string; help: string; mono: boolean };
export type ConnectorEvents = { key: string; label: string; details: string; events: ConnectorEvent[]; filters: ConnectorFilter[] };

export const humanize = (s: string) => {
  const words = s.replace(/_/g, " ");
  return words.slice(0, 1).toUpperCase() + words.slice(1);
};

export const github: ConnectorEvents = {
  key: "github",
  label: "GitHub",
  details: "On an event of its repository, through the GitHub App.",
  events: [
    { key: "pull_request", name: "Pull request", details: "Opened, updated, labelled or closed.", actions: ["opened", "reopened", "synchronize", "ready_for_review", "labeled", "closed"] },
    { key: "issues", name: "Issues", details: "Opened, labelled, reopened or closed.", actions: ["opened", "reopened", "labeled", "closed"] },
    { key: "issue_comment", name: "Issue comment", details: "A comment on an issue or a pull request.", actions: ["created", "edited"] },
    { key: "pull_request_review", name: "Pull request review", details: "A review submitted.", actions: ["submitted"] },
    { key: "push", name: "Push", details: "Commits pushed to a branch.", actions: [] },
  ],
  filters: [
    { key: "branch", label: "Branch", help: "A pull request’s base, or the branch pushed.", mono: true },
    { key: "label", label: "Label", help: "On the pull request or the issue.", mono: false },
  ],
};

export const taskModels = {
  // `TasksHelper#task_state`.
  state(t: TaskModel): [string, Tone] {
    if (t.archived) return ["Archived", "grey"];
    if (t.paused) return ["Paused", "grey"];
    if (t.lastError) return ["Last run failed", "red"];
    return ["Active", "green"];
  },
  // `TasksHelper#task_trigger`.
  trigger(t: TaskModel, catalogue: ConnectorEvents = github) {
    if (t.trigger === "webhook") return "Webhook";
    if (t.trigger === "connector") {
      const connector = catalogue.key === t.source ? catalogue : undefined;
      const said = connector?.events.find((e) => e.key === t.event)?.name ?? t.event;
      const acts = t.actions.map(humanize).join(" or ");
      return [connector?.label, said, acts || undefined].filter(Boolean).join(" · ");
    }
    return [scheduleModel.describe(t.cron), t.timezone].filter(Boolean).join(" · ");
  },
  // An archived task keeps its next_run_at but never fires (`Task.due` takes active tasks only).
  next(t: TaskModel) {
    if (t.archived) return "Not scheduled";
    if (t.trigger === "cron") return t.paused ? "Paused" : (t.nextRunAt ?? "Not scheduled");
    return t.trigger === "connector" ? "On event" : "On call";
  },
};

// A cron said in words: what a task's schedule form asks instead of the expression. "custom" is a cron that fits none
// of the others.
// Any of them can be empty ("") while the person has not chosen.
export type Schedule = { frequency: "" | "daily" | "weekdays" | "weekly" | "monthly" | "custom"; weekday: string; monthday: string; time: string };

// The days of the month a monthly run may take: 29 to 31 do not exist every month.
const monthDays = Array.from({ length: 28 }, (_, i) => i + 1);

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

export const scheduleModel = {
  frequencies: [["daily", "Every day"], ["weekdays", "Every weekday"], ["weekly", "Every week"], ["monthly", "Every month"], ["custom", "Custom"]] as const,
  weekdays: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  monthDays: monthDays.map((d) => ordinal(d)),
  ordinal,
  timePattern: /^([01]?\d|2[0-3]):([0-5]\d)$/,
  // The cron read back into the fields.
  parse(cron?: string): Schedule {
    const custom: Schedule = { frequency: "custom", weekday: "1", monthday: "1", time: "09:00" };
    const fields = (cron ?? "").trim().split(/\s+/);
    if (fields.length !== 5) return cron ? custom : { ...custom, frequency: "weekdays" };
    const [minute, hour, day, month, weekday] = fields;
    if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour) || month !== "*") return custom;
    const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
    if (day === "*" && weekday === "*") return { ...custom, frequency: "daily", time };
    if (day === "*" && weekday === "1-5") return { ...custom, frequency: "weekdays", time };
    if (day === "*" && /^[0-6]$/.test(weekday)) return { ...custom, frequency: "weekly", weekday, time };
    if (/^\d+$/.test(day) && monthDays.includes(Number(day)) && weekday === "*") return { ...custom, frequency: "monthly", monthday: day, time };
    return { ...custom, time };
  },
  // The cron for the fields; undefined while the time is not a time, or for "custom".
  compose(s: Schedule): string | undefined {
    const match = scheduleModel.timePattern.exec(s.time);
    if (!match || s.frequency === "" || s.frequency === "custom") return undefined;
    if ((s.frequency === "weekly" && s.weekday === "") || (s.frequency === "monthly" && s.monthday === "")) return undefined;
    const [, hour, minute] = match;
    const head = `${Number(minute)} ${Number(hour)}`;
    if (s.frequency === "daily") return `${head} * * *`;
    if (s.frequency === "weekdays") return `${head} * * 1-5`;
    if (s.frequency === "weekly") return `${head} * * ${s.weekday}`;
    return `${head} ${s.monthday} * *`;
  },
  // "Every weekday at 9:00"; the expression itself when the words cannot say it.
  describe(cron?: string): string {
    if (!cron) return "";
    const s = scheduleModel.parse(cron);
    if (s.frequency === "custom") return cron;
    const time = s.time.replace(/^0/, "");
    if (s.frequency === "daily") return `Every day at ${time}`;
    if (s.frequency === "weekdays") return `Every weekday at ${time}`;
    if (s.frequency === "weekly") return `Every ${scheduleModel.weekdays[Number(s.weekday)]} at ${time}`;
    return `On the ${ordinal(Number(s.monthday))} of every month at ${time}`;
  },
};

// What starts a webhook task, answered once by `PATCH tasks/{id}` or `POST tasks/{id}/token`.
export type TaskToken = { token: string; hookUrl: string };

// The session a Run now started (`POST tasks/{id}/run` → `session`).
export type StartedRun = { id: string; title: string };

// A run of a task: the session it started (`tasks/{id}/runs` → `sessions`).
export type RunModel = {
  id: string;
  title: string;
  // `running`, `waiting` or `idle`.
  status: string;
  archived?: boolean;
  branch: string;
  // `new`, `starting`, `running`, `paused`, `failed`.
  worktreeState: string;
  createdAt: string;
};

// What the run is doing, from the session's status and its machine's state.
export function runState(r: RunModel): [string, Tone] {
  if (r.archived) return ["Archived", "grey"];
  if (r.worktreeState === "failed" && r.status === "idle") return ["Setup failed", "red"];
  if (r.status === "running") return r.worktreeState === "starting" ? ["Starting", "orange"] : ["Working", "blue"];
  if (r.status === "waiting") return ["Needs your approval", "yellow"];
  return ["Idle", "grey"];
}

// A field a provider asks for (`llm/providers` → `fields`).
export type ProviderField = {
  key: string;
  // `select`, `password` or `text`.
  type: string;
  label: string;
  required?: boolean;
  secret?: boolean;
  help?: string;
  placeholder?: string;
  options: ModelOption[];
  // The kinds it is asked for; none means every kind.
  kinds?: string[];
};

// A vendor a credential is for (`llm/providers`): its fields and models, and the kinds that are connected with a
// code instead of typed.
export type ProviderModel = { key: string; label: string; defaultModel: string; models: ModelOption[]; fields: ProviderField[]; connect?: string[] };

// Where a connection of a credential stands (`llm/connections`), as the dialog shows it: `starting` while the code
// is asked for, `pending` with the code to enter, then `connected`; `expired`, `denied` and `failed` say why in
// `reason`, and `disabled` is the account having the device login off.
export type ConnectionModel = {
  state: "starting" | "pending" | "connected" | "expired" | "denied" | "failed" | "disabled";
  userCode?: string;
  verificationUrl?: string;
  reason?: string;
  // When the code ends, as a time of day.
  until?: string;
};

export const byDefault = "Credential’s default";
export const byMain = "Workspace’s main credential";

// A live credential an agent may name: its label, the vendor it runs and the models that vendor offers.
export type CredentialOption = { id: string; label: string; vendor: string; models: ModelOption[] };
export const optionLabel = (c: CredentialOption) => `${c.label} (${c.vendor})`;
export const modelLabel = (p: ProviderModel, id?: string) => p.models.find((m) => m.id === id)?.label ?? byDefault;

// The ids a third-party endpoint's credential lists in its `models` setting, as the API reads them (commas or
// lines, once each); none for any other kind, which keeps the provider's own models.
export function listedModels(settings: Record<string, string>): ModelOption[] {
  if (settings.kind !== "bearer") return [];
  const ids = (settings.models ?? "").split(/[,\n]/).map((id) => id.trim()).filter(Boolean);
  return [...new Set(ids)].map((id) => ({ id, label: id }));
}

// What a credential can run while it is being edited: its own list, else the provider's models. A saved
// credential answers the same in `models`.
export function offeredModels(p: ProviderModel, settings: Record<string, string>): ModelOption[] {
  const listed = listedModels(settings);
  return listed.length ? listed : p.models;
}

// A model credential (`llm/configs`). `settings` holds the readable values; secrets never come back.
export type CredentialModel = {
  id: string;
  provider: string;
  label: string;
  model: string;
  // What it can run (`models`); empty before the API said.
  models: ModelOption[];
  settings: Record<string, string>;
  main: boolean;
  archived: boolean;
  createdAt: string;
};

export function credentialModel(c: Partial<CredentialModel> & { id: string; provider: string; label: string; model: string }): CredentialModel {
  return { models: [], settings: {}, main: false, archived: false, createdAt: "", ...c };
}

export const credentialState = (c: CredentialModel): [string, Tone] => (c.archived ? ["Archived", "grey"] : c.main ? ["In use", "green"] : ["Not in use", "grey"]);

// A step of a workflow: its agent, instructions, check command, how it advances.
export type WorkflowStepModel = {
  // Empty for a step not saved yet.
  id: string;
  // Tells unsaved steps apart while they are sorted; never sent.
  key: string;
  name: string;
  agentId: string;
  instructions: string;
  gateCommand?: string;
  // `auto` or `manual`.
  advance: string;
  worktreeSessionStateId?: string;
};

export function workflowStep(s: Partial<WorkflowStepModel> & { agentId: string }): WorkflowStepModel {
  const id = s.id ?? "";
  return { id, key: s.key ?? (id || crypto.randomUUID()), name: "", instructions: "", advance: "auto", ...s };
}

// A workflow: steps carried out in one checkout, optionally narrowed to an environment.
export type WorkflowModel = { id: string; name: string; environmentId?: string; archived: boolean; steps: WorkflowStepModel[] };

// A column of the workspace's board a step can move the session to (`worktree_session_states`).
export type BoardStateModel = { id: string; name: string };

// Field errors as the forms show them, by field.
export type FieldErrors = Record<string, string>;

// A connector definition as the API serves it: filters per event, joined here into the connector's filters.
export type ConnectorDefinition = {
  key: string;
  label: string;
  details: string;
  events: { key: string; name: string; details: string; actions: string[]; filters: { key: string; label: string; help: string; mono: boolean }[] }[];
};

export function connectorEvents(d: ConnectorDefinition): ConnectorEvents {
  const filters = new Map<string, ConnectorFilter>();
  for (const e of d.events) for (const f of e.filters) if (!filters.has(f.key)) filters.set(f.key, { key: f.key, label: f.label, help: f.help, mono: f.mono });
  return { key: d.key, label: d.label, details: d.details, events: d.events.map(({ key, name, details, actions }) => ({ key, name, details, actions })), filters: [...filters.values()] };
}
