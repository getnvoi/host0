// Plain models the screens take; the app adapts the API's records to them.
import type { ActOutcome, ActState, Tool } from "../conversation";
import type { ComposerBadges } from "../composer";
import type { ThumbnailKind } from "../cards";
import type { Person } from "../primitives";
import type { TabInfo } from "../chrome";
import { avatarFill, type Tone } from "../tokens";

// One tool call as the conversation shows it.
export type ActionModel = { tool: Tool; target: string; outcome?: ActOutcome; state?: ActState };

// What a turn is made of: the agent either speaks or calls tools; people write messages and notes.
export type Part =
  | { kind: "message"; author: string; initials: string; time: string; text: string }
  | { kind: "agent"; name: string; time: string }
  | { kind: "prose"; text: string }
  | { kind: "actions"; summary: string; time: string; actions: ActionModel[] }
  | { kind: "note"; author: string; initials: string; time: string; text: string }
  | { kind: "artifact"; artifact: ArtifactModel };

// Something an agent made: a document, a deck, an app. Sections are its headings and paragraphs.
export type ArtifactModel = {
  // The artifact's id when it comes from the API, which its tab loads.
  id?: string;
  title: string;
  kind: string;
  glyph: string;
  session: string;
  author: string;
  initials: string;
  updated: string;
  size: string;
  sections: [string, string][];
  // The version the conversation shows, and every saved version when the artifact is loaded.
  version?: number;
  saved?: { number: number; author: string; time: string }[];
};

export const artifactModel = {
  meta: (a: ArtifactModel) => [a.kind, a.size, a.updated].filter(Boolean).join(" · "),
  thumb: (a: ArtifactModel): ThumbnailKind => (a.kind === "Deck" ? "deck" : a.kind === "App" ? "app" : "document"),
  // A saved version as its card in the conversation: the kind as a word, the version, by the session's agent.
  saved: (v: { id: string; name: string; kind: string; number: number }, agent: string): ArtifactModel => ({
    id: v.id,
    title: v.name,
    kind: v.kind.charAt(0).toUpperCase() + v.kind.slice(1),
    glyph: v.kind === "app" ? "app" : v.kind === "document" ? "doc" : v.kind === "sheet" ? "chart" : "artifact",
    session: "",
    author: agent,
    initials: "",
    updated: "",
    version: v.number,
    size: "",
    sections: [],
  }),
  excerpt: (a: ArtifactModel) => [a.sections[0]?.[0] ?? a.title, ...a.sections.slice(0, 2).map(([, text]) => text)],
};

export type GateModel = { title: string; tool: string; detail: string; added?: number; removed?: number };

export type WorkingModel = { text: string; tone: Tone; time?: string; action?: string };

export type ConversationModel = {
  tabs: TabInfo[];
  activeTab: number;
  workspace: string;
  initials: string;
  title: string;
  branch: string;
  state: [string, Tone];
  changes: number;
  parts: Part[];
  working?: WorkingModel;
  gate?: GateModel;
  badges: ComposerBadges;
  people: Person[];
  toast?: [string, Tone];
};

export type MemberModel = {
  name: string;
  email: string;
  initials: string;
  fill: string;
  role: string;
  repositories: string;
  joined: string;
  seen: string;
  you?: boolean;
};

export function memberModel(m: Omit<MemberModel, "fill"> & { fill?: string }): MemberModel {
  return { ...m, fill: m.fill ?? avatarFill(m.initials) };
}

// A repository as the API serves it (`repos`): GitHub full name, default branch, host, its environments.
export type RepositoryModel = {
  name: string;
  branch?: string;
  host: string;
  connection: string;
  environments: { name: string; option: string }[];
  sessions: number;
};

// A variable of an environment (`env_vars`); a secret's value is never sent back.
export type VariableModel = { key: string; value?: string; secret?: boolean };

// A command of an environment (`environment_commands`): setup, preview (a service with a port) or default.
export type CommandModel = { kind: string; name: string; command: string; port?: number };

// An environment as the API serves it: option and shape, disk, branch, preview port, manifest, database, variables
// and commands.
export type EnvironmentModel = {
  name: string;
  repository: string;
  branch: string;
  option: string;
  shape: string;
  disk: number;
  previewPort?: number;
  manifest?: string;
  database?: { engine: string; version: string };
  vars: VariableModel[];
  commands: CommandModel[];
};

// `shape` is vCPU x GB; the UI names it by size, as `ReposHelper::SIZES`.
export const sizes: Record<string, string> = { "2x4": "S", "4x8": "M", "8x16": "L", "16x32": "XL" };

export const environmentModel = {
  id: (e: EnvironmentModel) => `${e.repository}·${e.name}`,
  describe(shape: string) {
    const p = shape.split("x");
    if (p.length !== 2) return shape;
    return `${sizes[shape] ?? shape} · ${p[0]} vCPU · ${p[1]} GB`;
  },
  size: (e: EnvironmentModel) => environmentModel.describe(e.shape),
};

// One opening of a form from a list, with its own id. A save's result, refusal or busy state belongs to the opening
// that started it; the form shows them only when that id is its own.
export class FormOpening {
  id = crypto.randomUUID();
  open() {
    this.id = crypto.randomUUID();
  }
  // `now` when it belongs to this opening, or to none (samples); else `empty`.
  take<T>(now: T, form: string | undefined, empty: T): T {
    return form === undefined || form === this.id ? now : empty;
  }
}
