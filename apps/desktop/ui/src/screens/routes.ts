// Every place a tab can show, as a path. A tab takes the route's title and glyph.

export const settingsPages = [
  ["members", "Members", "people"],
  ["roles", "Roles", "gate"],
  ["usage", "Usage", "chart"],
  ["billing", "Billing", "card"],
  ["agents", "Agents", "bot"],
  ["skills", "Skills", "sparkle"],
  ["workflows", "Workflows", "workflow"],
  ["tasks", "Tasks", "task"],
  ["credentials", "Models", "key"],
  ["repositories", "Repositories", "repo"],
  ["environments", "Environments", "terminal"],
  ["connectors", "Connectors", "branch"],
  ["apps", "Apps", "app"],
  ["library", "Library", "file"],
  ["artifacts", "Artifacts", "artifact"],
  ["profile", "Profile", "at"],
  ["security", "Security", "lock"],
] as const;

// The pages merged under "Agent settings": one sidebar entry, shown as tabs in the page head.
export const agentSettings = ["agents", "skills", "workflows", "tasks", "credentials"] as const;
export const agentSettingsPlace = { title: "Agent settings", glyph: "bot" };

export type SettingsPage = (typeof settingsPages)[number][0];

export const paths = {
  home: "/home",
  sessions: "/sessions",
  board: "/board",
  inbox: "/inbox",
  session: (id: string) => `/sessions/${id}`,
  settings: (page: SettingsPage) => `/settings/${page}`,
  environment: (id: string) => `/environments/${id}`,
  newEnvironment: (repo?: string) => (repo ? `/environments/new?repo=${repo}` : "/environments/new"),
  task: (id?: string) => `/tasks/${id ?? "new"}`,
  agent: (id?: string) => `/agents/${id ?? "new"}`,
  skill: (id?: string) => `/skills/${id ?? "new"}`,
  workflow: (id?: string) => `/workflows/${id ?? "new"}`,
  credential: (id?: string) => `/credentials/${id ?? "new"}`,
  artifact: (id: string) => `/artifacts/${id}`,
  repository: (id: string) => `/repositories/${id}`,
};

const kinds: Record<string, { glyph: string; fresh: string; object: string }> = {
  environments: { glyph: "terminal", fresh: "New environment", object: "Environment" },
  tasks: { glyph: "task", fresh: "New task", object: "Task" },
  agents: { glyph: "bot", fresh: "New agent", object: "Agent" },
  skills: { glyph: "sparkle", fresh: "New skill", object: "Skill" },
  workflows: { glyph: "workflow", fresh: "New workflow", object: "Workflow" },
  credentials: { glyph: "key", fresh: "New credential", object: "Model" },
  artifacts: { glyph: "artifact", fresh: "Artifact", object: "Artifact" },
  repositories: { glyph: "repo", fresh: "Repository", object: "Repository" },
};

// What a record's page is called: the object first, then its name ("Skill · Release notes"). A new record, which has
// no name yet, keeps the page's own title ("New skill").
export function objectTitle(path: string, name: string): string {
  const [first, second] = path.split("?")[0].split("/").filter(Boolean);
  const kind = kinds[first];
  return kind && second && second !== "new" ? `${kind.object} · ${name}` : name;
}

// The object a record page shows, by the noun its form uses ("credential" is a Model).
export const objectOf = (noun: string) => (noun === "credential" ? "Model" : `${noun.charAt(0).toUpperCase()}${noun.slice(1)}`);

// The tab's glyph and default title for a path; a page renames its tab once it reads its item.
export function describe(path: string): { title: string; glyph: string } {
  const [first, second] = path.split("?")[0].split("/").filter(Boolean);
  if (first === "home") return { title: "Home", glyph: "home" };
  if (first === "sessions") return { title: second ? "Session" : "Sessions", glyph: "session" };
  if (first === "board") return { title: "Board", glyph: "board" };
  if (first === "inbox") return { title: "Inbox", glyph: "inbox" };
  if (first === "settings") {
    const page = settingsPages.find(([key]) => key === second) ?? settingsPages[0];
    // Pages that share a place share its title: the tab and the head say it, the page's tabs say which one is open.
    if ((agentSettings as readonly string[]).includes(page[0])) return agentSettingsPlace;
    return { title: page[1], glyph: page[2] };
  }
  const kind = kinds[first];
  if (kind) return { title: second === "new" ? kind.fresh : kind.fresh, glyph: kind.glyph };
  return { title: "Sessions", glyph: "session" };
}

// The object a path shows, whatever its view (`/sessions/<id>/preview`, `?log=1`): settings is one place whichever
// page it shows, a form (`.../new`) is its whole path, Home is none (each + opens its own).
// A path as an entry to go to (the commander's "Go to"): a page that shares a place keeps its own name, and `place`
// names that place (shown as a tag, not searched), so the five agent settings pages read Agents, Skills… and not five
// times "Agent settings".
export function destination(path: string): { title: string; glyph: string; place?: string } {
  const [first, second] = path.split("?")[0].split("/").filter(Boolean);
  const page = first === "settings" ? settingsPages.find(([key]) => key === second) : undefined;
  if (page && (agentSettings as readonly string[]).includes(page[0])) return { title: page[1], glyph: page[2], place: agentSettingsPlace.title };
  return describe(path);
}

export function place(path: string): string | undefined {
  const [first, second] = path.split("?")[0].split("/").filter(Boolean);
  if (!first || first === "home") return undefined;
  if (first === "settings") return "/settings";
  if (second === "new") return path;
  return second ? `/${first}/${second}` : `/${first}`;
}

// Two paths show the same object, so one tab holds it.
export function same(a: string, b: string) {
  const p = place(a);
  return p !== undefined && p === place(b);
}
