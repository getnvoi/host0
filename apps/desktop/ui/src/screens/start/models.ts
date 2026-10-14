// A workspace's first run as the hub and its plane serve it: the offer a workspace is made from, the provisioning
// run's lines, the agents' keys, a repository, the environment an agent proposes for it, and the seed's build.

// A plan of the hub's offer. `price` is cents per hour.
export type OnboardingPlan = { name: string; label: string; cpu: number; memory: number; price: number };

export type OnboardingOffer = { credit: number; currency: string; plans: OnboardingPlan[]; locations: { name: string; label: string }[] };

// What a new workspace is made from.
export type OnboardingWorkspace = { name: string; plan: string; location: string };

// A repository the GitHub App reaches: `name` is `owner/name`.
export type OnboardingRepo = { id: string; name: string };

// A machine tier of the plane (`GET cluster/shape`): `cpu` and `memory` as the cluster writes them ("2", "4Gi").
export type OnboardingTier = { name: string; cpu: string; memory: string; default?: boolean };

// The environment as the person edits it before the seed builds: its tier, the command that serves the preview and
// its port, the setup commands one per line.
export type OnboardingEnvironment = { name: string; tier: string; start: string; port: number; setup: string };

// The keys the agents sign in with: Anthropic's (or a Claude setup-token) and OpenAI's. Empty is not given.
export type OnboardingKeys = { anthropic: string; openai: string };

// A log as it streams: its lines, and how it ended. `failed` holds the failed step's own line.
export type OnboardingLog = { lines: string[]; state: "running" | "ok" | "failed"; failed?: string };

export const onboardingSteps = ["workspace", "boot", "agent", "repository", "environment", "seed"] as const;
export type OnboardingStep = (typeof onboardingSteps)[number];

// `owner/name` split.
export const repoParts = {
  owner: (r: OnboardingRepo) => r.name.split("/")[0] ?? "",
  short: (r: OnboardingRepo) => r.name.split("/").pop() ?? r.name,
};
