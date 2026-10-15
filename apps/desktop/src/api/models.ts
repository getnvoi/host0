// Records as the hub and the plane serve them (README.md), the fields the app reads.
import { words, type Tone } from "@hz/ui";

// The hub.
export type User = { login: string; name?: string | null; avatar_url?: string | null };
export type Workspace = { name: string; plan: string; location: string; ready: boolean; run?: string | null };
export type Plan = { name: string; label: string; cpu: number; memory: number; hourly_cents: number };
export type Offer = { credit_cents: number; currency: string; plans: Plan[]; locations: { name: string; label: string }[] };
// One message of a provisioning run's stream: a line, or the run's end with the failed step's own line.
export type RunEvent = { line: string; state?: "ok" | "failed" };
export type Repository = { full_name: string; default_branch: string; private: boolean };
export type Repositories = { install_url: string; repositories: Repository[] };

// The plane (internal/workspace's JSON).
export type State = "forking" | "running" | "idle" | "awaiting_approval" | "failed";

export type Event = {
  kind: string;
  tool?: string;
  content?: string;
  tool_id?: string;
  parent?: string;
  at?: string;
  meta?: { duration_ms?: number; tokens?: number };
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
  by?: string;
  at: string;
  last: string;
};

export type Session = Omit<Summary, "prompt" | "queued"> & { events: Event[]; turns: number; pending?: string };

export type Approval = { id: string; session: string; tool: string; input: string; state: "pending" | "approved" | "denied" | "done" | "failed"; outcome?: string };

export type EnvironmentSummary = { name: string; repo: string; branch: string; tier: string; ready: boolean };

export type Service = { name: string; image?: string; command: string; port?: number; env?: Record<string, string>; early?: boolean };

export type Environment = {
  name: string;
  repo: string;
  branch: string;
  image: string;
  env?: Record<string, string>;
  secrets?: Record<string, string>;
  setup: string[] | null;
  services: Service[] | null;
  preview: number;
  tier?: string;
  tools: Record<string, string> | null;
};

export type Seed = { env: string; state: "building" | "ready" | "failed"; step?: string; line?: string; lines?: number; error?: string; preview?: string; at: string };

export type Update =
  | { kind: "session"; session: Summary; from?: number; events?: Event[] }
  | { kind: "approval"; approval: Approval }
  | { kind: "seed"; seed: Seed }
  | { kind: "reset" };

export type Changes = { base: string; at: string; added: number; removed: number; truncated?: boolean; files: unknown[] | null; patch: string };

export type Field = { key: string; label: string; type: "text" | "password" | "select"; secret?: boolean; required?: boolean; options?: { value: string; label: string }[]; default?: string; placeholder?: string; help?: string };
export type Provider = { key: string; label: string; fields: Field[] };
export type LlmConfig = { name: string; provider: string; values: Record<string, string>; stored?: string[]; main: boolean; archived_at?: string; at: string };

export type PreviewStatus = { up: boolean; status?: number; error?: string };

export const repoName = {
  short: (name: string) => name.split("/").pop() ?? name,
};

// How a session reads in lists and the commander.
export function reason(s: { state: State }): [string, Tone] {
  switch (s.state) {
    case "failed":
      return ["Failed", "red"];
    case "awaiting_approval":
      return ["Waiting on you", "yellow"];
    case "forking":
      return ["Setting up the machine", "orange"];
    case "running":
      return ["Working", "blue"];
    default:
      return ["Idle", "grey"];
  }
}

export const age = (time: string, now = Date.now()) => words.age(time, new Date(now));

export function initials(name?: string) {
  if (!name) return "?";
  const parts = name.split(/[ ._-]/).filter(Boolean);
  const letters = parts.length > 1 ? parts.slice(0, 2).map((p) => p[0]) : [...name.slice(0, 2)];
  return letters.join("").toUpperCase();
}
