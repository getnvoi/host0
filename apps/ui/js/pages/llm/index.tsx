import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslations } from "@/contexts/i18n";
import { messageFrom } from "@/contexts/api/errors";
import { useArchiveConfig, useConfigs, useProviders, useRemoveConfig, useRestoreConfig, useUseConfig } from "@/contexts/api/llm";
import type { LlmConfig, Provider } from "@/contexts/api/types";
import { Shell } from "@/shell/shell";
import { Alert } from "@/ds/alert";
import { Badge } from "@/ds/badge";
import { Button } from "@/ds/button";
import { Dialog } from "@/ds/dialog";
import { Empty } from "@/ds/empty";
import { Head } from "@/ds/head";
import { Inline } from "@/ds/inline";
import { List, ListCell, ListName, ListRow } from "@/ds/list";
import { Menu } from "@/ds/menu";
import { Page } from "@/ds/page";
import { Status } from "@/ds/status";
import { toast } from "@/ds/toast";

// How the credential signs in, in the provider's own words: "Anthropic API key".
export function kindLabel(provider: Provider | undefined, c: LlmConfig) {
  return provider?.fields.find((f) => f.key === "kind")?.options?.find((o) => o.value === c.values.kind)?.label;
}

function modelLabel(provider: Provider | undefined, c: LlmConfig) {
  const field = provider?.fields.find((f) => f.key === "model");
  const value = c.values.model;
  return field?.options?.find((o) => o.value === value)?.label ?? value;
}

// Add credential: straight to the form with one provider, a menu of providers otherwise.
function AddCredential({ providers, variant = "outline" }: { providers: Provider[]; variant?: "outline" | "solid" }) {
  const { t } = useTranslations();
  if (providers.length === 1)
    return (
      <Button variant={variant} glyph="plus" href={`/llm/new?provider=${providers[0].key}`}>
        {t("llm.add")}
      </Button>
    );
  return (
    <Menu
      align="end"
      label={t("llm.add_for")}
      items={providers.map((p) => ({ label: p.label, icon: "llm", href: `/llm/new?provider=${p.key}` }))}
      trigger={
        <Button variant={variant} glyph="plus" glyphAfter="chevron-down">
          {t("llm.add")}
        </Button>
      }
    />
  );
}

// The model credentials: one is in use, and every turn runs on it.
export function LlmPage() {
  const { t } = useTranslations();
  const [params, setParams] = useSearchParams();
  const archived = params.get("archived") === "1";
  const configs = useConfigs();
  const providers = useProviders();
  const use = useUseConfig();
  const archive = useArchiveConfig();
  const restore = useRestoreConfig();
  const remove = useRemoveConfig();
  const [removing, setRemoving] = useState<string>();
  const all = configs.data ?? [];
  const any = all.length > 0;
  const shown = archived ? all : all.filter((c) => !c.archived_at);
  const provider = (key: string) => providers.data?.find((p) => p.key === key);
  const list = providers.data ?? [];

  const act = (run: Promise<unknown>, said: string) =>
    run.then(
      () => toast({ kind: "success", message: said }),
      (e) => toast({ kind: "error", message: messageFrom(e, t) }),
    );

  return (
    <Shell rail={false} place="home">
      <Page
        layout="list"
        head={
          <Head
            title={t("llm.title")}
            icon="llm"
            filters={
              any && (
                <Menu
                  align="end"
                  items={[{ group: t("llm.show"), items: [{ label: t("llm.archived"), toggle: "archived", checked: archived }] }]}
                  onFlip={(_, on) => setParams(on ? { archived: "1" } : {})}
                  trigger={
                    <Button glyph="sliders" glyphAfter="chevron-down">
                      {t("llm.view")}
                    </Button>
                  }
                />
              )
            }
            action={<AddCredential providers={list} />}
          />
        }
      >
        {configs.error && <Alert tone="error">{messageFrom(configs.error, t)}</Alert>}
        <List
          columns={[t("llm.credential"), t("llm.model"), t("llm.state"), ""]}
          template="minmax(0, 1fr) 150px 190px 28px"
          label={t("llm.title")}
          empty={
            configs.isSuccess &&
            (any ? (
              <Empty
                icon="llm"
                heading="h3"
                filtered
                text={t("llm.all_archived")}
                action={
                  <Inline gap={8}>
                    <AddCredential providers={list} variant="solid" />
                    <Button variant="ghost" href="/llm?archived=1">
                      {t("llm.show_archived")}
                    </Button>
                  </Inline>
                }
              />
            ) : (
              <Empty icon="llm" heading="h3" title={t("llm.none_title")} text={t("llm.none_text")} action={<AddCredential providers={list} variant="solid" />} />
            ))
          }
        >
          {shown.map((c) => {
            const p = provider(c.provider);
            return (
              <ListRow
                key={c.name}
                off={!!c.archived_at}
                name={<ListName title={c.name} text={[p?.label ?? c.provider, kindLabel(p, c)].filter(Boolean).join(" · ")} icon="llm" href={`/llm/${encodeURIComponent(c.name)}`} />}
                cells={
                  <>
                    <ListCell>{modelLabel(p, c) && <Badge kind>{modelLabel(p, c)}</Badge>}</ListCell>
                    <ListCell>
                      {c.archived_at ? (
                        <Status>{t("llm.is_archived")}</Status>
                      ) : c.main ? (
                        <Status state="ok">{t("llm.in_use")}</Status>
                      ) : (
                        <Status>{t("llm.not_in_use")}</Status>
                      )}
                    </ListCell>
                  </>
                }
                menu={
                  <Menu
                    align="end"
                    items={[
                      { label: t("llm.edit"), glyph: "pencil", href: `/llm/${encodeURIComponent(c.name)}` },
                      !c.archived_at && !c.main && {
                        label: t("llm.use"),
                        glyph: "check",
                        attrs: { onClick: () => act(use.mutateAsync(c.name), t("llm.used", { name: c.name })) },
                      },
                      c.archived_at
                        ? { label: t("llm.restore"), glyph: "restore", attrs: { onClick: () => act(restore.mutateAsync(c.name), t("llm.restored", { name: c.name })) } }
                        : { label: t("llm.archive"), glyph: "archive", attrs: { onClick: () => act(archive.mutateAsync(c.name), t("llm.archived_one", { name: c.name })) } },
                      "separator",
                      { label: t("llm.remove"), glyph: "trash", danger: true, attrs: { onClick: () => setRemoving(c.name) } },
                    ]}
                    trigger={<Button variant="ghost" size="sm" glyph="more-horizontal" label={t("llm.actions_for", { name: c.name })} />}
                  />
                }
              />
            );
          })}
        </List>
      </Page>
      <Dialog
        id="remove-credential"
        alert
        open={!!removing}
        title={t("llm.remove_title", { name: removing ?? "" })}
        text={t("llm.remove_text")}
        onClose={() => setRemoving(undefined)}
        foot={
          <>
            <Button variant="ghost" onClick={() => setRemoving(undefined)}>
              {t("llm.cancel")}
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() =>
                removing && act(remove.mutateAsync(removing), t("llm.removed", { name: removing })).then(() => setRemoving(undefined))
              }
            >
              {t("llm.remove_confirm")}
            </Button>
          </>
        }
      />
    </Shell>
  );
}
