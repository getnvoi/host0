// Settings › Environments, an environment's page and a new environment on the plane. An environment's name is its id;
// the form's draft becomes the whole environment, sent with one PUT. Its variables are `env` and `secrets`, its setup
// commands `setup`, its preview and other commands its services.
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import {
  EnvironmentForm, EnvironmentScreen, EnvironmentsScreen, paths, sandboxOption, useNavigate, type CodeError, type CodeLoad, type DryRun, type EnvironmentDetail, type EnvironmentDraft,
  type Repo, type SandboxOption,
} from "@hz/ui";
import { ApiError, get, request, workspace } from "../../api/client";
import { stale, useApi, useHub } from "../../api/live";
import type { Environment, EnvironmentSummary, Repositories, Session } from "../../api/models";
import { message, sessionTitle } from "../../api/session";
import { store } from "../../store";

type Tier = { name: string; cpu: string; memory: string; default?: boolean };

const codeErrorOf = (e: unknown): CodeError => ({ error: message(e), code: e instanceof ApiError && e.status === 404 ? "not_found" : "refused" });

// A tier as a machine size: "500m" CPU is half a core, "4Gi" four GB.
const optionOf = (t: Tier): SandboxOption => ({
  label: t.name,
  provider: "hz",
  cpu: t.cpu.endsWith("m") ? Number(t.cpu.slice(0, -1)) / 1000 : Number(t.cpu),
  memory: Number(t.memory.replace(/[^\d.]/g, "")),
  onRequest: false,
  cost: 0,
  currency: "EUR",
});

function shapeOf(tier: string | undefined, tiers: Tier[]) {
  const t = tiers.find((x) => x.name === tier) ?? tiers.find((x) => x.default);
  return t ? sandboxOption.shape(optionOf(t)) : "";
}

export function detailOf(e: Environment, tiers: Tier[]): EnvironmentDetail {
  return {
    id: e.name,
    repoId: e.repo,
    name: e.name,
    providerName: "hz",
    shape: shapeOf(e.tier, tiers),
    disk: 0,
    branch: e.branch,
    previewPort: e.preview || undefined,
    vars: [
      ...Object.entries(e.env ?? {}).map(([key, value]) => ({ key, value, secret: false })),
      ...Object.keys(e.secrets ?? {}).map((key) => ({ key, secret: true })),
    ],
    commands: [
      ...(e.setup ?? []).map((command, i) => ({ id: `setup ${i}`, kind: "setup", name: `Setup ${i + 1}`, command, before: [], position: i })),
      ...(e.services ?? []).map((s, i) => ({ id: `service ${s.name}`, kind: s.port && s.port === e.preview ? "preview" : "default", name: s.name, command: s.command, port: s.port, before: [], position: i })),
    ],
    restricted: false,
    memberIds: [],
    createdAt: "",
  };
}

// The draft as the whole environment: what the form does not show (image, tools, each service's own image and
// variables) is kept from the one it edits.
function environmentOf(d: EnvironmentDraft, old: Environment | undefined, options: SandboxOption[]): Environment {
  const services = d.commands.filter((c) => c.kind !== "setup");
  const port = Number(d.previewPort) || 0;
  return {
    ...(old ?? { image: "", tools: {} }),
    name: d.name.trim(),
    repo: d.repoId,
    branch: d.branch,
    tier: sandboxOption.of(options, d.providerName, d.shape)?.label,
    preview: port,
    env: Object.fromEntries(d.vars.filter((v) => !v.secret && v.key).map((v) => [v.key, v.value])),
    // An empty secret keeps the stored value.
    secrets: Object.fromEntries(d.vars.filter((v) => v.secret && v.key).map((v) => [v.key, v.value])),
    setup: d.commands.filter((c) => c.kind === "setup").map((c) => c.command),
    services: services.map((c) => {
      const was = old?.services?.find((s) => s.name === c.name);
      return { ...was, name: c.name, command: c.command, port: c.kind === "preview" ? port || Number(c.port) || undefined : Number(c.port) || undefined };
    }),
  };
}

// The repositories the GitHub App reaches, with the environments each holds.
function useRepos(environments: EnvironmentSummary[]) {
  const listed = useHub<Repositories>(`workspaces/${encodeURIComponent(workspace() ?? "")}/repositories`);
  const names = [...new Set([...(listed.data?.repositories ?? []).map((r) => r.full_name), ...environments.map((e) => e.repo)])];
  const repos: Repo[] = names.map((name) => ({
    id: name,
    name,
    owner: name.split("/")[0] ?? "",
    defaultBranch: listed.data?.repositories.find((r) => r.full_name === name)?.default_branch,
    environments: environments.filter((e) => e.repo === name).map((e) => ({ id: e.name, name: e.name, providerName: "hz" })),
    createdAt: "",
  }));
  return { listed, repos };
}

function useTiers() {
  const shape = useApi<{ tiers: Tier[] }>("cluster/shape");
  const tiers = shape.data?.tiers ?? [];
  return { tiers, options: tiers.map(optionOf) };
}

export function EnvironmentsPage() {
  const navigate = useNavigate();
  const summaries = useApi<EnvironmentSummary[]>("environments");
  const { repos, listed } = useRepos(summaries.data ?? []);
  const { tiers, options } = useTiers();
  // The list holds names and repositories: each environment is read for the page's columns.
  const full = useQueries({
    queries: (summaries.data ?? []).map((e) => ({ queryKey: ["api", `environments/${encodeURIComponent(e.name)}`], queryFn: () => get<Environment>(`environments/${encodeURIComponent(e.name)}`) })),
  });
  const [dryRun, setDryRun] = useState<{ environment: string; state: DryRun }>();
  const [failure, setFailure] = useState<CodeError>();
  const details = full.every((q) => q.data) ? full.map((q) => detailOf(q.data!, tiers)) : [];
  const environments: CodeLoad<EnvironmentDetail[]> = failure
    ? { failed: failure }
    : summaries.error
      ? { failed: codeErrorOf(summaries.error) }
      : summaries.data
        ? { loaded: details.length ? details : summaries.data.map((s) => detailOf({ name: s.name, repo: s.repo, branch: s.branch, tier: s.tier, image: "", setup: [], services: [], preview: 0, tools: {} }, tiers)) }
        : "loading";
  return (
    <EnvironmentsScreen
      repos={listed.error ? { failed: codeErrorOf(listed.error) } : listed.data ? { loaded: repos } : "loading"}
      environments={environments}
      options={options}
      engines={[]}
      dryRun={dryRun}
      onNew={(r) => navigate(paths.newEnvironment(r?.id))}
      onDelete={(e) =>
        void request("DELETE", `environments/${encodeURIComponent(e.id)}`)
          .then(() => void stale())
          .catch((err) => setFailure(codeErrorOf(err)))
      }
      // A dry run is a session with no prompt: the fork comes up and serves the preview.
      onDryRun={(e) => {
        setDryRun({ environment: e.id, state: "starting" });
        request<Session>("POST", "sessions", { env: e.id, prompt: "" })
          .then((s) =>
            setDryRun({
              environment: e.id,
              state: { started: { id: s.id, title: sessionTitle(s), status: "running", environmentId: e.id, worktree: { id: s.id, branch: s.branch, state: "starting", hostname: s.preview, serving: false }, createdAt: s.at } },
            }),
          )
          .catch((err) => setDryRun({ environment: e.id, state: { refused: codeErrorOf(err) } }));
      }}
      onRetry={() => {
        setFailure(undefined);
        void summaries.refetch();
        void listed.refetch();
      }}
    />
  );
}

function Form({ environment, repo }: { environment?: Environment; repo?: string }) {
  const navigate = useNavigate();
  const summaries = useApi<EnvironmentSummary[]>("environments");
  const { repos } = useRepos(summaries.data ?? []);
  const { tiers, options } = useTiers();
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<CodeError>();
  const [saved, setSaved] = useState(false);
  return (
    <EnvironmentForm
      environment={environment && detailOf(environment, tiers)}
      repos={repos}
      repo={repo}
      options={{ loaded: options }}
      engines={{ loaded: [] }}
      databaseOptions={[]}
      productionOptions={[]}
      members={[]}
      refusal={refusal}
      saving={saving}
      saved={saved}
      back={() => navigate(paths.settings("environments"))}
      onSave={(d) => {
        if (environment && d.name.trim() !== environment.name) return setRefusal({ error: "An environment's name is its id; it does not change.", code: "name" });
        setSaving(true);
        setRefusal(undefined);
        const next = environmentOf(d, environment, options);
        request("PUT", `environments/${encodeURIComponent(next.name)}`, next)
          .then(() => {
            setSaved(true);
            void stale("environments");
            if (!environment) navigate(paths.environment(next.name), "here", next.name);
          })
          .catch((e) => setRefusal(codeErrorOf(e)))
          .finally(() => setSaving(false));
      }}
      onDelete={() =>
        environment &&
        void request("DELETE", `environments/${encodeURIComponent(environment.name)}`)
          .then(() => {
            void stale("environments");
            navigate(paths.settings("environments"));
          })
          .catch((e) => setRefusal(codeErrorOf(e)))
      }
    />
  );
}

export function EnvironmentPage() {
  const id = decodeURIComponent(useParams().id ?? "");
  const env = useApi<Environment>(`environments/${encodeURIComponent(id)}`);
  useEffect(() => {
    if (env.data) store.retitle(paths.environment(id), env.data.name);
  }, [env.data?.name]);
  const { tiers } = useTiers();
  const load: CodeLoad<EnvironmentDetail> = env.data ? { loaded: detailOf(env.data, tiers) } : env.error ? { failed: codeErrorOf(env.error) } : "loading";
  return <EnvironmentScreen name={id} load={load} retry={() => void env.refetch()} form={() => <Form environment={env.data} />} />;
}

export function NewEnvironmentPage() {
  const [params] = useSearchParams();
  return <Form repo={params.get("repo") ?? undefined} />;
}
