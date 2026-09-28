import { useState, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslations } from "@/contexts/i18n";
import { messageFrom } from "@/contexts/api/errors";
import { useAddConfig, useConfigs, useProviders, useUpdateConfig } from "@/contexts/api/llm";
import type { Field as FieldSpec, LlmConfig, Provider } from "@/contexts/api/types";
import { Shell } from "@/shell/shell";
import { Alert } from "@/ds/alert";
import { Button } from "@/ds/button";
import { Field } from "@/ds/field";
import { Head } from "@/ds/head";
import { Inline } from "@/ds/inline";
import { Page } from "@/ds/page";
import { Section } from "@/ds/section";
import { Skeleton } from "@/ds/skeleton";
import { Stack } from "@/ds/stack";
import { toast } from "@/ds/toast";

// New at /llm/new?provider=, edit at /llm/:name. The form is the provider's field list; nothing here knows its fields.
export function LlmFormPage() {
  const { t } = useTranslations();
  const { name } = useParams();
  const [params] = useSearchParams();
  const providers = useProviders();
  const configs = useConfigs();
  const config = name ? configs.data?.find((c) => c.name === name) : undefined;
  const key = config?.provider ?? params.get("provider") ?? "";
  const provider = providers.data?.find((p) => p.key === key);
  const loading = providers.isPending || (name && configs.isPending);
  const missing = !loading && (!provider || (name && !config));

  return (
    <Shell rail={false} place="home">
      {loading ? (
        <Page layout="column" width="form">
          <Skeleton />
        </Page>
      ) : missing ? (
        <Page layout="column" width="form" head={<Head title={t("llm.title")} icon="llm" back="/llm" backLabel={t("llm.back")} />}>
          <Alert tone="error">{name ? t("llm.not_found", { name }) : t("llm.unknown_provider")}</Alert>
        </Page>
      ) : (
        <CredentialForm provider={provider!} config={config} />
      )}
    </Shell>
  );
}

function CredentialForm({ provider, config }: { provider: Provider; config?: LlmConfig }) {
  const { t } = useTranslations();
  const navigate = useNavigate();
  const add = useAddConfig();
  const update = useUpdateConfig();
  const [label, setLabel] = useState(config?.name ?? provider.label);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(provider.fields.map((f) => [f.key, config?.values[f.key] ?? f.default ?? (f.type === "select" ? (f.options?.[0]?.value ?? "") : "")])),
  );
  const [error, setError] = useState<string>();
  const back = config?.archived_at ? "/llm?archived=1" : "/llm";
  const busy = add.isPending || update.isPending;
  const set = (k: string, v: string) => setValues((was) => ({ ...was, [k]: v }));
  const access = provider.fields.filter((f) => f.key !== "model");
  const model = provider.fields.find((f) => f.key === "model");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    try {
      if (config) await update.mutateAsync({ name: config.name, values });
      else await add.mutateAsync({ name: label.trim(), provider: provider.key, values });
      toast({ kind: "success", message: config ? t("llm.saved", { name: config.name }) : t("llm.added", { name: label.trim() }) });
      navigate(back);
    } catch (err) {
      setError(messageFrom(err, t));
    }
  };

  const field = (f: FieldSpec) => {
    const stored = !!config?.stored?.includes(f.key);
    const common = {
      key: f.key,
      id: `llm_${f.key}`,
      name: f.key,
      label: f.label,
      help: f.help && `${f.help.replace(/\.$/, "")}.`,
      value: values[f.key] ?? "",
      onChange: (e: { target: { value: string } }) => set(f.key, e.target.value),
    };
    if (f.type === "select")
      return <Field {...common} as="select" required={f.required} items={(f.options ?? []).map((o) => [o.label, o.value] as [string, string])} />;
    return (
      <Field
        {...common}
        type={f.type}
        mono
        placeholder={stored ? t("llm.stored") : f.placeholder}
        required={f.required && !stored}
        autoComplete="off"
      />
    );
  };

  return (
    <form onSubmit={submit} id="llm-form">
      <Page
        layout="column"
        width="form"
        head={
          <Head
            title={config ? config.name : t("llm.new")}
            icon="llm"
            subtitle={provider.label}
            back={back}
            backLabel={t("llm.back")}
            action={
              <Inline gap={8}>
                <Button variant="ghost" href={back}>
                  {t("llm.cancel")}
                </Button>
                <Button variant="solid" type="submit" loading={busy}>
                  {config ? t("llm.save") : t("llm.add")}
                </Button>
              </Inline>
            }
          />
        }
      >
        {error && <Alert tone="error">{error}</Alert>}
        <Section name={t("llm.general")} icon="llm" text={t("llm.general_text")}>
          <Field
            id="llm_label"
            name="label"
            label={t("llm.label")}
            value={label}
            required
            disabled={!!config}
            help={config ? t("llm.label_fixed") : undefined}
            onChange={(e: { target: { value: string } }) => setLabel(e.target.value)}
            autoComplete="off"
            autoFocus={!config}
          />
        </Section>
        <Section name={t("llm.access")} icon="secret" text={t("llm.access_text")}>
          <Stack gap={16}>{access.map(field)}</Stack>
        </Section>
        {model && (
          <Section name={t("llm.model")} text={t("llm.model_text")}>
            {field(model)}
          </Section>
        )}
      </Page>
    </form>
  );
}
