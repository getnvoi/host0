import { onboardingRecord, type OnboardingProvider, type OnboardingOption, type OnboardingRecord, type OnboardingRepo } from "./models";

const provider: OnboardingProvider = {
  key: "claude_code",
  label: "Claude Code",
  fields: [
    {
      key: "kind",
      type: "select",
      label: "Credential kind",
      required: true,
      options: [
        { value: "oauth", label: "Claude subscription (OAuth)" },
        { value: "api_key", label: "Anthropic API key" },
        { value: "bearer", label: "Third-party endpoint (bearer)" },
      ],
    },
    { key: "token", type: "password", label: "Token", required: true, secret: true, placeholder: "sk-ant-..." },
    { key: "base_url", type: "text", label: "Base URL", placeholder: "https://api.anthropic.com" },
  ],
};

const options: OnboardingOption[] = [
  { label: "S", cpu: 2, memory: 4, price: 41.67, currency: "EUR", onRequest: false },
  { label: "M", cpu: 4, memory: 8, price: 83.07, currency: "EUR", onRequest: false },
  { label: "L", cpu: 8, memory: 16, price: 165.87, currency: "EUR", onRequest: true },
];

const repos: OnboardingRepo[] = [
  { id: "r1", name: "benbonnet/dummy-rails", imported: true },
  { id: "g2", name: "benbonnet/notes", imported: false },
  { id: "g3", name: "benbonnet/site", imported: false },
];

// A new workspace, before GitHub.
const fresh = onboardingRecord("Northwind", { options, provider });
// GitHub connected.
const connected: OnboardingRecord = { ...fresh, accounts: [{ login: "benbonnet", type: "User", repositories: 12 }], repos };
// Connected, GitHub still reading the repositories.
const reading: OnboardingRecord = { ...connected, repos: [], reading: true };
// A repository imported, its environment not saved yet.
const imported: OnboardingRecord = { ...connected, repo: repos[0] };
// The environment saved; no credential yet.
const ready: OnboardingRecord = { ...imported, environment: { option: "S", start: "bin/rails server -p 3000", setup: "bundle install" } };
// A credential and two agents already in the workspace.
const staffed: OnboardingRecord = { ...ready, credential: true, agents: [{ id: "a1", name: "Dev" }, { id: "a2", name: "Reviewer" }] };

// Onboarding records for the gallery, one per state the API defines.
export const startSamples = { provider, options, repos, fresh, connected, reading, imported, ready, staffed };
