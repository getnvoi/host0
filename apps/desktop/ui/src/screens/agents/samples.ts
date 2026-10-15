// Fixtures for the gallery, shaped on the examples in `doc/openapi.yaml` and the web views.
import {
  agentModel, credentialModel, skillModel, taskModel, workflowStep,
  type AgentToolModel, type BoardStateModel, type GrantLevel, type ConnectionModel, type CredentialOption, type PlaceModel, type ProviderModel, type RunModel, type TaskToken, type WorkflowModel,
} from "./models";

const devInstructions =
  "You work inside a checkout of the repository, your working directory. On your first turn, call set_title with a short name for the task. " +
  "When you change what a page looks like, call create_screenshot on it so the user sees it. Anything that touches GitHub (push, pull request) " +
  "goes through the h0 tools: you have no credentials. An h0 tool answering 'Queued' is normal: end your turn right after. Answer briefly.";

// Tools granted at their default level.
const defaults: Record<string, GrantLevel> = {
  set_title: "auto",
  ask_user: "approval",
  create_screenshot: "auto",
  push_branch: "auto",
  create_pull_request: "approval",
  open_artifact: "auto",
  save_artifact: "auto",
  search_sessions: "auto",
  search_artifacts: "auto",
  search_library: "auto",
  Bash: "auto",
  WebFetch: "approval",
  WebSearch: "approval",
  fetch_page: "auto",
  browse: "auto",
  record_video: "auto",
  save_page: "auto",
  list_processes: "auto",
  stop_process: "auto",
};

const provider: ProviderModel = {
  key: "claude_code",
  label: "Claude Code",
  defaultModel: "sonnet",
  models: [
    { id: "opus", label: "Opus" },
    { id: "sonnet", label: "Sonnet" },
    { id: "haiku", label: "Haiku" },
  ],
  fields: [
    {
      key: "kind",
      type: "select",
      label: "Credential kind",
      required: true,
      help: "oauth for a Claude subscription, api_key for an Anthropic key, bearer for a third-party endpoint such as z.ai or Kimi.",
      options: [
        { id: "oauth", label: "Claude subscription (OAuth)" },
        { id: "api_key", label: "Anthropic API key" },
        { id: "bearer", label: "Third-party endpoint (bearer)" },
      ],
    },
    { key: "token", type: "password", label: "Token", required: true, secret: true, placeholder: "sk-ant-...", options: [] },
    { key: "base_url", type: "text", label: "Base URL", help: "Only for a third-party endpoint. Leave empty for Anthropic.", placeholder: "https://api.anthropic.com", options: [] },
    { key: "models", type: "text", label: "Models", help: "Only for a third-party endpoint: the model ids it runs, separated by commas. The first is the default. Leave empty to offer Opus, Sonnet and Haiku.", placeholder: "glm-4.6, glm-4.5-air", options: [] },
  ],
};

const skills = [
  skillModel({
    id: "s1",
    name: "PDF filling",
    slug: "pdf-filling",
    tagline: "Fills PDF forms",
    description: "Use when the user asks to fill in, complete or sign a PDF form.",
    example: "fill in this form for me",
    body: "## Steps\n\n1. Read the form.\n2. List the fields it asks for.\n3. Fill them, then sign.",
    files: [
      { id: "f1", path: "sign.sh", position: 1 },
      { id: "f2", path: "fields.md", position: 2 },
    ],
    createdAt: "2026-09-12T10:00:00Z",
  }),
  skillModel({
    id: "s2",
    name: "Release notes",
    slug: "release-notes",
    tagline: "Writes them",
    description: "Use when asked for release notes.",
    example: "write the release notes",
    body: "## Steps",
    createdAt: "2026-09-20T10:00:00Z",
  }),
  skillModel({
    id: "s3",
    name: "Frontend design",
    slug: "frontend-design",
    tagline: "Builds pages that do not look generated",
    description: "Use when the user asks to build or restyle a web page or component.",
    example: "make the pricing page",
    body: "## Principles\n\nOne typeface, a real grid, and no gradients.",
    source: "default",
    readOnly: true,
    createdAt: "2026-01-01T00:00:00Z",
  }),
];

// The tools an agent may be granted, as `agents/tools` serves them: by category, each at its default level.
const agentTools: AgentToolModel[] = [
  { name: "set_title", label: "Set title", category: "Sessions", asks: false, outbound: false, level: "auto" },
  { name: "ask_user", label: "Question", category: "Sessions", asks: true, outbound: false, level: "approval" },
  { name: "search_sessions", label: "Search sessions", category: "Sessions", asks: false, outbound: false, level: "auto" },
  { name: "look", label: "Read page", category: "Preview", asks: false, outbound: false, level: "auto" },
  { name: "find", label: "Find in page", category: "Preview", asks: false, outbound: false, level: "auto" },
  { name: "click", label: "Click", category: "Preview", asks: false, outbound: false, level: "auto" },
  { name: "hover", label: "Hover", category: "Preview", asks: false, outbound: false, level: "auto" },
  { name: "type", label: "Type", category: "Preview", asks: false, outbound: false, level: "auto" },
  { name: "fill", label: "Fill form", category: "Preview", asks: false, outbound: false, level: "auto" },
  { name: "press", label: "Press key", category: "Preview", asks: false, outbound: false, level: "auto" },
  { name: "scroll", label: "Scroll", category: "Preview", asks: false, outbound: false, level: "auto" },
  { name: "open", label: "Open address", category: "Preview", asks: false, outbound: false, level: "auto" },
  { name: "back", label: "Go back", category: "Preview", asks: false, outbound: false, level: "auto" },
  { name: "forward", label: "Go forward", category: "Preview", asks: false, outbound: false, level: "auto" },
  { name: "reload", label: "Reload", category: "Preview", asks: false, outbound: false, level: "auto" },
  { name: "wait", label: "Wait", category: "Preview", asks: false, outbound: false, level: "auto" },
  { name: "screenshot", label: "Screenshot", category: "Preview", asks: false, outbound: false, level: "auto" },
  { name: "evaluate", label: "Run script", category: "Preview", asks: false, outbound: false, level: "auto" },
  { name: "push_branch", label: "Push branch", category: "Repositories", asks: false, outbound: true, level: "auto" },
  { name: "create_pull_request", label: "Pull request", category: "Repositories", asks: false, outbound: true, level: "auto" },
  { name: "Bash", label: "Bash", category: "Shell", asks: false, outbound: false, level: "auto" },
  { name: "WebFetch", label: "Fetch", category: "Web", asks: false, outbound: true, level: "approval" },
  { name: "WebSearch", label: "Web search", category: "Web", asks: false, outbound: true, level: "approval" },
  { name: "open_artifact", label: "Open artifact", category: "Artifacts", asks: false, outbound: false, level: "auto" },
  { name: "save_artifact", label: "Save artifact", category: "Artifacts", asks: false, outbound: false, level: "auto" },
  { name: "read_sheet", label: "Read sheet", category: "Artifacts", asks: false, outbound: false, level: "auto" },
  { name: "write_sheet", label: "Write sheet", category: "Artifacts", asks: false, outbound: false, level: "auto" },
  { name: "search_artifacts", label: "Search artifacts", category: "Artifacts", asks: false, outbound: false, level: "auto" },
  { name: "search_library", label: "Search library", category: "Library", asks: false, outbound: false, level: "auto" },
];

// What always waits on a person, as `AgentResource#locked` serves it.
const locked = [
  { category: "Agents", tools: ["agent_create", "agent_archive", "agent_restore", "agent_update"], level: "approval" },
  { category: "Environments", tools: ["environment_create", "environment_command_delete", "env_var_delete", "environment_delete", "utils_dry_run_start", "environment_command_set", "env_var_set", "environment_update"], level: "approval" },
  { category: "Sessions", tools: ["agent_session_answer"], level: "approval" },
  { category: "Skills", tools: ["skill_file_create", "skill_create", "skill_archive", "skill_file_archive", "skill_restore", "skill_update"], level: "approval" },
  { category: "Tasks", tools: ["task_create", "task_archive", "task_restore", "task_start", "task_update"], level: "approval" },
  { category: "Workflows", tools: ["workflow_create", "workflow_archive", "workflow_restore", "workflow_update"], level: "approval" },
];

// Codex has no WebFetch (Bash's level governs fetching) and searches without asking.
const codexRefusals = [{ tool: "WebSearch", level: "approval", reason: "Codex searches the web without asking" }];

const agents = [
  agentModel({ id: "a1", name: "Dev", slug: "dev", tagline: "Ships", instructions: devInstructions, tools: defaults, locked, skillIds: ["s1"], createdAt: "2026-01-01T00:00:00Z" }),
  agentModel({
    id: "a2",
    name: "Reviewer",
    slug: "reviewer",
    tagline: "Reads a diff and leaves notes",
    model: "opus",
    instructions: "Review it. Say which tests you ran.",
    // Not granted push_branch, create_pull_request or WebSearch: it has no such tools.
    tools: (({ push_branch, create_pull_request, WebSearch, ...granted }) => ({ ...granted, Bash: "approval" as const }))(defaults),
    createdAt: "2026-02-01T00:00:00Z",
  }),
  agentModel({ id: "a3", name: "Writer", slug: "writer", model: "haiku", instructions: "Small steps.", tools: { ...defaults, create_pull_request: "auto", WebFetch: "auto" }, skillIds: ["s2", "s3"], createdAt: "2026-03-01T00:00:00Z" }),
];

const archivedAgents = [agentModel({ id: "a9", name: "Minimal", slug: "minimal", tools: defaults, archived: true, createdAt: "2026-01-01T00:00:00Z" })];

const places: PlaceModel[] = [
  { id: "e1", name: "staging", repository: "benbonnet/dummy-rails" },
  { id: "e2", name: "development", repository: "benbonnet/dummy-rails" },
  { id: "e3", name: "development", repository: "northwind/web" },
];

const boardStates: BoardStateModel[] = [
  { id: "b1", name: "Pending" },
  { id: "b2", name: "In progress" },
  { id: "b3", name: "Review" },
  { id: "b4", name: "Production" },
];

const workflows: WorkflowModel[] = [
  {
    id: "w1",
    name: "Ship a fix",
    environmentId: "e1",
    archived: false,
    steps: [
      workflowStep({ id: "ws1", name: "Build", agentId: "a1", instructions: "Make the change and its tests.", gateCommand: "bin/rails test", worktreeSessionStateId: "b2" }),
      workflowStep({ id: "ws2", name: "Review", agentId: "a2", instructions: "Read the diff and leave notes.", advance: "manual", worktreeSessionStateId: "b3" }),
      workflowStep({ id: "ws3", name: "Fix", agentId: "a1", instructions: "Address the notes.", gateCommand: "bin/rails test" }),
    ],
  },
  { id: "w2", name: "Write the docs", archived: false, steps: [workflowStep({ id: "ws4", name: "Draft", agentId: "a3", instructions: "Write the page from the diff." })] },
];

const archivedWorkflows: WorkflowModel[] = [
  { id: "w9", name: "Old release", archived: true, steps: [workflowStep({ id: "ws9", name: "Tag", agentId: "a1", instructions: "Tag the release." })] },
];

const tasks = [
  taskModel({ id: "t1", name: "Nightly", prompt: "Update the lockfile.", environmentId: "e1", agentId: "a1", cron: "0 9 * * 1-5", timezone: "Europe/Paris", nextRunAt: "Thu 2 Oct, 09:00 CEST", lastRunAt: "2026-10-01T07:00:00Z", createdAt: "2026-09-01T00:00:00Z" }),
  taskModel({ id: "t2", name: "Triage", prompt: "Triage it.", trigger: "webhook", environmentId: "e3", agentId: "a2", createdAt: "2026-09-02T00:00:00Z" }),
  taskModel({
    id: "t3",
    name: "Review pull requests",
    prompt: "Review the pull request and leave notes.",
    trigger: "connector",
    source: "github",
    environmentId: "e1",
    agentId: "a2",
    workflowId: "w1",
    event: "pull_request",
    actions: ["opened", "ready_for_review"],
    filters: { branch: "main", label: "review" },
    createdAt: "2026-09-03T00:00:00Z",
  }),
  taskModel({
    id: "t4",
    name: "Weekly report",
    prompt: "Write the weekly report.",
    environmentId: "e2",
    agentId: "a9",
    cron: "0 8 * * 1",
    timezone: "UTC",
    nextRunAt: "Mon 6 Oct, 08:00 UTC",
    lastRunAt: "2026-09-29T08:00:00Z",
    lastError: "Minimal is archived. Choose another agent below, or restore Minimal.",
    createdAt: "2026-09-04T00:00:00Z",
  }),
  taskModel({ id: "t5", name: "Dependency check", prompt: "Check for outdated gems.", environmentId: "e2", agentId: "a1", cron: "0 6 * * *", timezone: "UTC", paused: true, createdAt: "2026-09-05T00:00:00Z" }),
];

const archivedTasks = [
  taskModel({ id: "t9", name: "Gone", prompt: "Update the lockfile.", environmentId: "e1", agentId: "a1", cron: "0 9 * * 1-5", timezone: "UTC", nextRunAt: "Thu 2 Oct, 09:00 UTC", archived: true, createdAt: "2026-01-01T00:00:00Z" }),
];

const runs: RunModel[] = [
  { id: "r1", title: "Nightly", status: "running", branch: "dummy-rails-7f3a21", worktreeState: "running", createdAt: "Wed 1 Oct, 09:00" },
  { id: "r2", title: "Nightly", status: "waiting", branch: "dummy-rails-51c0d4", worktreeState: "running", createdAt: "Tue 30 Sept, 09:00" },
  { id: "r3", title: "Nightly", status: "idle", branch: "dummy-rails-0be917", worktreeState: "paused", createdAt: "Mon 29 Sept, 09:00" },
  { id: "r4", title: "Nightly", status: "idle", branch: "dummy-rails-c2a77e", worktreeState: "failed", createdAt: "Fri 26 Sept, 09:00" },
];

const startingRun: RunModel = { id: "r0", title: "Nightly", status: "running", branch: "dummy-rails-9d02aa", worktreeState: "starting", createdAt: "Wed 1 Oct, 09:00" };

const token: TaskToken = { token: "nvt_4mW8qPz2Xc9LhT6yRb1NvK3sJd7Fa5Ge", hookUrl: "https://h0.example.com/hooks/tasks/01a0ec3b-e954-7b6d-bdf9-8374b1be4e00" };

const credentials = [
  credentialModel({ id: "c1", provider: "claude_code", label: "Work", model: "sonnet", settings: { kind: "oauth", model: "sonnet" }, main: true, createdAt: "2026-01-01T00:00:00Z" }),
  credentialModel({ id: "c2", provider: "claude_code", label: "z.ai", model: "haiku", settings: { kind: "bearer", model: "haiku", base_url: "https://z.ai" }, createdAt: "2026-02-01T00:00:00Z" }),
  credentialModel({ id: "c3", provider: "claude_code", label: "Anthropic API", model: "opus", settings: { kind: "api_key", model: "opus" }, createdAt: "2026-03-01T00:00:00Z" }),
];

// The same two vendors as the credential options of an agent's form.
const codexProvider: ProviderModel = {
  key: "codex",
  label: "Codex",
  defaultModel: "",
  connect: ["chatgpt"],
  models: [
    { id: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
    { id: "gpt-6-luna", label: "GPT-6 Luna" },
    { id: "gpt-5.5", label: "GPT-5.5" },
  ],
  fields: [
    {
      key: "kind",
      type: "select",
      label: "Credential kind",
      required: true,
      help: "An OpenAI API key (API prices), or a ChatGPT subscription you connect with a code (plan credits).",
      options: [
        { id: "api_key", label: "OpenAI API key" },
        { id: "chatgpt", label: "ChatGPT subscription" },
      ],
    },
    { key: "token", type: "password", label: "API key", required: true, secret: true, placeholder: "sk-...", kinds: ["api_key"], options: [] },
  ],
};

const codexCredential = credentialModel({ id: "c4", provider: "codex", label: "OpenAI", model: "", settings: { kind: "api_key" }, createdAt: "2026-04-01T00:00:00Z" });
const chatgptCredential = credentialModel({ id: "c5", provider: "codex", label: "ChatGPT", model: "", settings: { kind: "chatgpt", account: "ben@example.com" }, createdAt: "2026-05-01T00:00:00Z" });
const chatgptNew = credentialModel({ id: "", provider: "codex", label: "ChatGPT", model: "", settings: { kind: "chatgpt" } });

// The dialog of a connection in each state.
const connections: Record<string, ConnectionModel> = {
  starting: { state: "starting" },
  pending: { state: "pending", userCode: "D6XX-A3K9P", verificationUrl: "https://auth.openai.com/codex/device", until: "14:32" },
  connected: { state: "connected" },
  expired: { state: "expired", reason: "The code expired before it was approved. Connect again." },
  denied: { state: "denied", reason: "The sign-in was denied in the browser." },
  failed: { state: "failed", reason: "OpenAI refused the exchange (status 400: invalid_grant)." },
  disabled: { state: "disabled", reason: "Device login is not enabled for this ChatGPT account. In ChatGPT, open Settings, then Security, and turn on device code login for Codex (a workspace admin may need to allow it), then connect again." },
};

const credentialOptions: CredentialOption[] = [
  { id: "c1", label: "Work", vendor: "Claude Code", models: provider.models },
  { id: "c4", label: "OpenAI", vendor: "Codex", models: codexProvider.models },
];

const archivedCredentials = [
  credentialModel({ id: "c9", provider: "claude_code", label: "Home", model: "haiku", settings: { kind: "oauth", model: "haiku" }, archived: true, createdAt: "2026-01-01T00:00:00Z" }),
];

const zones = ["UTC", "Europe/London", "Europe/Paris", "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Australia/Sydney"];

export const agentsSamples = {
  provider,
  skills,
  archivedSkills: [skillModel({ id: "s9", name: "Gone", slug: "gone", archived: true, createdAt: "2026-01-01T00:00:00Z" })],
  agents,
  codexRefusals,
  agentTools,
  archivedAgents,
  // Every agent, archived ones included, for names a task or step points at.
  allAgents: [...agents, ...archivedAgents],
  places,
  boardStates,
  workflows,
  archivedWorkflows,
  tasks,
  archivedTasks,
  runs,
  startingRun,
  token,
  credentials,
  codexProvider,
  codexCredential,
  chatgptCredential,
  chatgptNew,
  connections,
  credentialOptions,
  archivedCredentials,
  zones,
  failed: "The server did not answer. Check your connection and try again.",
};
