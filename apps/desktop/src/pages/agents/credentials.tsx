// Settings › Models and a credential's page on the plane's `llm/configs`. A credential's name is its id and its label;
// the list holds the live and the archived ones together.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { CredentialForm, credentialModel, CredentialsScreen, paths, useNavigate, type CredentialModel, type FieldErrors, type Fetched, type ProviderModel } from "@hz/ui";
import { request } from "../../api/client";
import { stale, useApi } from "../../api/live";
import type { LlmConfig, Provider } from "../../api/models";
import { message } from "../../api/session";
import { store } from "../../store";

const path = (name: string) => `llm/configs/${encodeURIComponent(name)}`;

// The model is a field like the others on the plane; the screens show it apart, with the provider's choices.
const modelField = (p: Provider) => p.fields.find((f) => f.key === "model");

export const providerOf = (p: Provider): ProviderModel => {
  const model = modelField(p);
  return {
    key: p.key,
    label: p.label,
    defaultModel: model?.default ?? "",
    models: (model?.options ?? []).map((o) => ({ id: o.value, label: o.label })),
    fields: p.fields
      .filter((f) => f.key !== "model")
      .map((f) => ({ key: f.key, type: f.type, label: f.label, required: !!f.required, secret: !!f.secret, help: f.help, placeholder: f.placeholder, options: (f.options ?? []).map((o) => ({ id: o.value, label: o.label })) })),
    connect: [],
  };
};

export const credentialOf = (c: LlmConfig, providers: Provider[]): CredentialModel => {
  const { model = "", ...settings } = c.values;
  const p = providers.find((x) => x.key === c.provider);
  return credentialModel({
    id: c.name,
    provider: c.provider,
    label: c.name,
    model,
    models: p ? providerOf(p).models : [],
    settings,
    main: c.main,
    archived: !!c.archived_at,
    createdAt: c.at.slice(0, 10),
  });
};

export function CredentialsPage() {
  const providers = useApi<Provider[]>("llm/providers");
  const configs = useApi<LlmConfig[]>("llm/configs");
  const [archived, setArchived] = useState(false);
  const [failure, setFailure] = useState<string>();
  const all = (configs.data ?? []).map((c) => credentialOf(c, providers.data ?? []));
  const failed = configs.error ?? providers.error;
  const state: Fetched<CredentialModel[]> = failure
    ? { failed: failure }
    : failed
      ? { failed: message(failed) }
      : configs.data && providers.data
        ? { ready: all.filter((c) => c.archived === archived) }
        : "loading";
  const change = (write: () => Promise<unknown>) =>
    void write()
      .then(() => setFailure(undefined))
      .catch((e) => setFailure(message(e)))
      .finally(() => void stale("llm"));
  return (
    <CredentialsScreen
      state={state}
      providers={(providers.data ?? []).map(providerOf)}
      archived={archived}
      anyArchived={all.some((c) => c.archived)}
      actions={{
        showArchived: setArchived,
        retry: () => {
          setFailure(undefined);
          void configs.refetch();
          void providers.refetch();
        },
        use: (c) => change(() => request("POST", `${path(c.id)}/main`)),
        archive: (c) => change(() => request("DELETE", path(c.id))),
        restore: (c) => change(() => request("POST", `${path(c.id)}/restore`)),
        remove: (c) => change(() => request("DELETE", `${path(c.id)}?remove=1`)),
      }}
    />
  );
}

// One credential in its tab; `/credentials/new` is a new one, on the first provider.
export function CredentialPage() {
  const id = decodeURIComponent(useParams().id ?? "new");
  const isNew = id === "new";
  const navigate = useNavigate();
  const providers = useApi<Provider[]>("llm/providers");
  const configs = useApi<LlmConfig[]>(isNew ? undefined : "llm/configs");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [generation, setGeneration] = useState(0);
  const back = () => navigate(paths.settings("credentials"));

  const found = useMemo(() => {
    const vendors = providers.data ?? [];
    if (isNew) {
      const provider = vendors[0];
      if (!provider) return { failed: "The workspace lists no providers." };
      const model = providerOf(provider).defaultModel;
      return { credential: credentialModel({ id: "", provider: provider.key, label: "", model, settings: { model } }), provider: providerOf(provider) };
    }
    const record = (configs.data ?? []).find((c) => c.name === id);
    if (!record) return { failed: "That does not exist." };
    const provider = vendors.find((p) => p.key === record.provider);
    if (!provider) return { failed: `The workspace lists no provider ${record.provider}.` };
    return { credential: credentialOf(record, vendors), provider: providerOf(provider) };
  }, [providers.data, configs.data, isNew, id]);
  const loading = providers.isPending || (!isNew && configs.isPending);
  const failed = providers.error ?? configs.error;
  const pending = failed ? { failed: message(failed) } : loading ? ("loading" as const) : "failed" in found ? { failed: found.failed! } : undefined;

  useEffect(() => {
    if (!isNew && "credential" in found && found.credential) store.retitle(paths.credential(id), found.credential.label);
  }, [found, id, isNew]);

  const reload = () => {
    setErrors({});
    void configs.refetch().then(() => setGeneration((g) => g + 1));
    void stale("llm");
  };
  const refused = (e: unknown) => setErrors({ base: message(e) });

  return (
    <CredentialForm
      key={`${id}:${generation}`}
      credential={"credential" in found && found.credential ? found.credential : credentialModel({ id: "", provider: "", label: isNew ? "" : "Model credential", model: "" })}
      provider={"provider" in found && found.provider ? found.provider : undefined}
      providers={isNew ? (providers.data ?? []).map(providerOf) : undefined}
      errors={errors}
      saving={saving}
      pending={pending}
      retry={() => {
        void providers.refetch();
        if (!isNew) void configs.refetch();
      }}
      back={back}
      actions={{
        save: (c, token) => {
          if (!isNew && c.label !== c.id) return setErrors({ label: "A credential's label is its name; it does not change." });
          setSaving(true);
          // The token only when one was typed; the plane keeps the stored one otherwise.
          const values: Record<string, string> = Object.fromEntries(Object.entries({ ...c.settings, model: c.model }).filter(([, v]) => v !== "" && v !== undefined)) as Record<string, string>;
          if (token) values.token = token;
          (isNew ? request<LlmConfig>("POST", "llm/configs", { name: c.label, provider: c.provider, values }) : request<LlmConfig>("PUT", path(c.id), { values }))
            .then((saved) => {
              if (isNew) navigate(paths.credential(saved.name), "here", saved.name);
              else reload();
            })
            .catch((e) => setErrors({ base: message(e) }))
            .finally(() => setSaving(false));
        },
        use: (c) => void request("POST", `${path(c.id)}/main`).then(reload).catch(refused),
        archive: (c) =>
          void request("DELETE", path(c.id))
            .then(() => {
              void stale("llm");
              back();
            })
            .catch(refused),
        restore: (c) => void request("POST", `${path(c.id)}/restore`).then(reload).catch(refused),
        remove: (c) =>
          void request("DELETE", `${path(c.id)}?remove=1`)
            .then(() => {
              void stale("llm");
              back();
            })
            .catch(refused),
      }}
    />
  );
}
