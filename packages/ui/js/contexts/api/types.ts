// Mirrors packages/shared/contract and the plane's JSON. The Go types are the source; change both together.

export type State = "forking" | "running" | "idle" | "awaiting_approval" | "failed";

export type Event = {
  kind: "prompt" | "status" | "message" | "thinking" | "tool_use" | "tool_result" | "task" | "result" | "error" | "notice" | "stopped";
  tool?: string;
  content?: string;
  tool_id?: string;
  parent?: string;
  at?: string;
  meta?: { duration_ms?: number; tokens?: number };
};

export type Task = {
  state?: "started" | "progress" | "notification";
  status?: string;
  type?: string;
  description?: string;
  activity?: string;
  summary?: string;
  tokens?: number;
  tools?: number;
  duration_ms?: number;
  last_tool?: string;
};

export type Summary = {
  id: string;
  env: string;
  branch: string;
  preview: string;
  state: State;
  title?: string;
  prompt: string;
  error?: string;
  queued: number;
  at: string;
  last: string;
};

export type Session = Omit<Summary, "prompt" | "queued"> & { events: Event[]; turns: number; pending?: string };

export type Approval = {
  id: string;
  session: string;
  tool: string;
  input: string;
  state: "pending" | "approved" | "denied" | "done" | "failed";
  outcome?: string;
};

export type Environment = { name: string; repo: string; branch: string; tier: string; ready: boolean };

export type Me = { cluster: string; zone: string };

export type FileChange = {
  path: string;
  old_path?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  added: number;
  removed: number;
  binary?: boolean;
};

export type Changes = {
  base: string;
  at: string;
  added: number;
  removed: number;
  truncated?: boolean;
  files: FileChange[];
  patch: string;
};

export type LogSource = { name: string; kind: "setup" | "service" };

export type Terminal = { id: string; command: string; started: string; clients: number };

export type Update =
  | { kind: "session"; session: Summary; from?: number; events?: Event[] }
  | { kind: "approval"; approval: Approval }
  | { kind: "reset" };

export type UsageDay = {
  day: string;
  compute: Record<string, number>;
  states: { running: number; paused: number; suspended: number };
  sessions: number;
  pull_requests: number;
  tokens: number;
  nodes: number;
};

export type Usage = {
  from: string;
  to: string;
  people: string[];
  totals: { sessions: number; compute_minutes: number; pull_requests: number; tokens: number; approvals: number; approval_wait_ms: number };
  days: UsageDay[];
  environments: { name: string; compute_minutes: number; sessions: number; pull_requests: number; tokens: number }[];
};

export type PreviewStatus = { up: boolean; status?: number; error?: string };

export type Option = { value: string; label: string };
export type Field = {
  key: string;
  label: string;
  type: "text" | "password" | "select";
  secret?: boolean;
  required?: boolean;
  options?: Option[];
  default?: string;
  placeholder?: string;
  help?: string;
};
export type Provider = { key: string; label: string; fields: Field[] };
export type LlmConfig = {
  name: string;
  provider: string;
  values: Record<string, string>;
  stored?: string[];
  main: boolean;
  archived_at?: string;
  at: string;
};
