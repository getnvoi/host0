// A workspace's first run as `GET onboarding` serves it, with the GitHub connections, the repositories they reach
// and the machine sizes the steps offer.

// A GitHub connection (`github/installations`). `type` is `User` or `Organization`, as GitHub names it.
export type OnboardingAccount = { login: string; type: string; repositories: number };

// A repository to pick: imported (`id` is the repo's) or reached through a connection (`id` is GitHub's).
// `name` is `owner/name`.
export type OnboardingRepo = { id: string; name: string; imported: boolean };

// A machine size the site offers (`environments/options`, `sandbox[]`). `price` is cents per hour, none when the site
// bills nothing.
export type OnboardingOption = { label: string; cpu: number; memory: number; price?: number; currency: string; onRequest: boolean };

// The repository's environment once saved: its option (a label), start (preview) command and setup command.
export type OnboardingEnvironment = { option: string; start: string; setup: string };

export type OnboardingAgent = { id: string; name: string };

// A credential field of the default provider. `type` is `select`, `password` or `text`.
export type OnboardingField = {
  key: string;
  type: string;
  label: string;
  required?: boolean;
  secret?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
};

// The runner new agents use, and the fields of a credential for it.
export type OnboardingProvider = { key: string; label: string; fields: OnboardingField[] };

export type OnboardingRecord = {
  workspace: string;
  accounts: OnboardingAccount[];
  // GitHub is still answering which repositories the connections reach.
  reading: boolean;
  repos: OnboardingRepo[];
  // The repository onboarding is about.
  repo?: OnboardingRepo;
  options: OnboardingOption[];
  environment?: OnboardingEnvironment;
  agents: OnboardingAgent[];
  // The workspace has a model credential; without one, the agent step asks for it.
  credential: boolean;
  provider: OnboardingProvider;
};

// A record with nothing decided yet.
export function onboardingRecord(workspace: string, more: Partial<OnboardingRecord> = {}): OnboardingRecord {
  return { workspace, accounts: [], reading: false, repos: [], options: [], agents: [], credential: false, provider: { key: "", label: "", fields: [] }, ...more };
}

// The onboarding screen's state: reading the record, the error it failed with, or the record.
export type OnboardingLoad = "loading" | { failed: string } | { ready: OnboardingRecord };

export const onboardingSteps = ["workspace", "github", "repository", "environment", "agent", "session"] as const;
export type OnboardingStep = (typeof onboardingSteps)[number];

// `owner/name` split.
export const repoParts = {
  owner: (r: OnboardingRepo) => r.name.split("/")[0] ?? "",
  short: (r: OnboardingRepo) => r.name.split("/").pop() ?? r.name,
};
