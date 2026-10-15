import { useState } from "react";
import { Enabled } from "../../clickable";
import { Cell, ColumnHeads, RowMenu, TableRow } from "../../data";
import { FormActions, FormFoot, FormSection } from "../../forms";
import { ConfirmDialog, Dialog } from "../../heads";
import { SelectInput, TextInput } from "../../inputs";
import { listEmpty, ListPage } from "../../lists";
import { menu, type MenuEntry } from "../../menu";
import { Button, Field, Item, LoadingState, Pill, Tag } from "../../primitives";
import { Notice } from "../../conversation";
import { useNavigate } from "../navigate";
import { paths } from "../routes";
import { SettingsShell } from "../shell";
import { byDefault, credentialState, fetched, matching, modelLabel, offeredModels, type ConnectionModel, type CredentialModel, type FieldErrors, type Fetched, type ProviderField, type ProviderModel } from "./models";
import { RecordPage, useAgentTabs, useDraft, type Pending } from "./parts";
import { agentsSamples } from "./samples";

// What the model credentials pages ask the app to do.
export type CredentialActions = {
  showArchived?: (on: boolean) => void;
  retry?: () => void;
  // A credential with an empty id is new: `POST llm/configs`; otherwise `PATCH llm/configs/{id}`. `token` is the
  // secret typed in, empty to keep the stored one.
  save?: (credential: CredentialModel, token: string) => void;
  // `PATCH llm/configs/{id}` with `main: true`.
  use?: (credential: CredentialModel) => void;
  archive?: (credential: CredentialModel) => void;
  restore?: (credential: CredentialModel) => void;
  // `DELETE llm/configs/{id}`: gone for good, the token with it.
  remove?: (credential: CredentialModel) => void;
  // `POST llm/connections`: asks for a code and shows the dialog; a credential with an id is renewed.
  connect?: (credential: CredentialModel) => void;
  // `DELETE llm/connections/{id}`, and the dialog closes.
  cancelConnection?: () => void;
  openLink?: (url: string) => void;
};

// The workspace's model credentials: label, vendor and kind, the model it runs, the one in use. A row opens the
// credential's page in the tab.
export function CredentialsScreen({
  state, providers = [agentsSamples.provider], archived: initial = false, anyArchived = false, query: initialQuery = "", actions = {},
}: { state: Fetched<CredentialModel[]>; providers?: ProviderModel[]; archived?: boolean; anyArchived?: boolean; query?: string; actions?: CredentialActions }) {
  const [query, setQuery] = useState(initialQuery);
  const [archived, setArchived] = useState(initial);
  const [open, setOpen] = useState<string>();
  const navigate = useNavigate();
  const tabs = useAgentTabs("credentials");
  const all = fetched.value(state) ?? [];
  const kept = matching(all, query, (c) => c.label);
  const edit = (c: CredentialModel) => navigate(paths.credential(c.id), "here", c.label);
  const kind = (c: CredentialModel) => {
    const p = providers.find((x) => x.key === c.provider);
    const field = p?.fields.find((f) => f.type === "select");
    const option = field?.options.find((o) => o.id === c.settings[field.key]);
    return [p?.label ?? c.provider, option?.label].filter(Boolean).join(" · ");
  };
  const entries = (c: CredentialModel): MenuEntry[] => {
    const editing = menu.item("Edit", { glyph: "gear", action: () => edit(c) });
    if (c.archived) return [editing, menu.item("Restore", { glyph: "restore", action: () => actions.restore?.(c) })];
    return [
      editing,
      ...(c.main ? [] : [menu.item("Use for new sessions", { glyph: "check", action: () => actions.use?.(c) })]),
      menu.divider,
      menu.item("Archive", { glyph: "archive", destructive: true, action: () => actions.archive?.(c) }),
    ];
  };
  return (
    <SettingsShell active="Models">
      <ListPage
        tabs={tabs}
        title="Models"
        glyph="key"
        state={fetched.list(state)}
        total={all.length}
        shown={kept.length}
        query={query}
        onQuery={setQuery}
        archived={archived}
        onArchived={(on) => {
          setArchived(on);
          actions.showArchived?.(on);
        }}
        anyArchived={anyArchived}
        empty={listEmpty("key", { noun: "model", plural: "models", text: "A session runs on a credential for its model’s vendor. Add one to start." })}
        retry={actions.retry}
        action={
          <Button kind="primary" size="small" glyph="plus" onClick={() => navigate(paths.credential(), "here", "New credential")}>
            New credential
          </Button>
        }
        rows={
          <div className="flex flex-col">
            <ColumnHeads columns={[["Credential", null], ["Model", 120], ["State", 110, "trailing"], ["", 28, "trailing"]]} />
            {kept.map((c, i) => {
              const p = providers.find((x) => x.key === c.provider);
              const [word, tone] = credentialState(c);
              return (
                <TableRow key={c.id} index={i} raised={open === c.id} action={() => edit(c)}>
                  <div className="flex w-full items-center gap-4">
                    <Item title={c.label} line={{ sub: kind(c) }} lead={{ visual: "key" }} />
                    <Cell width={120}>
                      <Tag text={c.models.find((m) => m.id === c.model)?.label ?? (p ? modelLabel(p, c.model) : c.model)} size="small" />
                    </Cell>
                    <Cell width={110} alignment="trailing">
                      {/* Archived repeats the filter; the cell stays, empty. */}
                      {!c.archived && <Pill text={word} tone={tone} />}
                    </Cell>
                    <RowMenu label={`Actions for ${c.label}`} open={open === c.id} onOpenChange={(on) => setOpen(on ? c.id : undefined)} entries={entries(c)} />
                  </div>
                </TableRow>
              );
            })}
          </div>
        }
      />
    </SettingsShell>
  );
}

export type CredentialFormProps = {
  credential: CredentialModel;
  provider?: ProviderModel;
  // Every vendor a new credential may be for; with more than one, a new form asks which.
  providers?: ProviderModel[];
  errors?: FieldErrors;
  saving?: boolean;
  // Opens the confirmation to remove the credential for good.
  removing?: boolean;
  pending?: Pending;
  retry?: () => void;
  actions?: CredentialActions;
  back?: () => void;
  // The connection in progress: its dialog is shown while there is one.
  connection?: ConnectionModel;
};

// One credential as a full page, built from its provider's fields. The token is sealed on save and never shown
// back.
export function CredentialForm({ credential: original, provider: given = agentsSamples.provider, providers = [], errors = {}, saving, removing: initialRemoving = false, pending, retry, actions = {}, back, connection }: CredentialFormProps) {
  const [credential, setCredential, changed] = useDraft(original);
  // The secret typed in; empty keeps the stored one.
  const [token, setToken] = useState("");
  const [removing, setRemoving] = useState(initialRemoving);
  const isNew = !original.id;
  // The vendor a new credential is on follows the choice; a saved one keeps its own.
  const provider = (isNew && providers.find((p) => p.key === credential.provider)) || given;
  const heading = pending || !isNew ? original.label : "New credential";
  const offered = offeredModels(provider, credential.settings);
  const setting = (key: string, value?: string) => {
    const settings = { ...credential.settings };
    if (value) settings[key] = value;
    else delete settings[key];
    // A model the new list or kind does not offer gives way to the first one it does.
    const options = offeredModels(provider, settings);
    if (options.length && !options.some((m) => m.id === credential.model)) {
      const model = options.some((m) => m.id === provider.defaultModel) ? provider.defaultModel : options[0].id;
      setCredential({ ...credential, model, settings: { ...settings, model } });
    } else setCredential({ ...credential, settings });
  };
  // The kind asked for: the one chosen, else the first the form offers.
  const kind = credential.settings.kind ?? provider.fields.find((f) => f.key === "kind")?.options[0]?.id;
  const connected = !!kind && !!provider.connect?.includes(kind);
  const asked = (field: ProviderField) => !field.kinds || (!!kind && field.kinds.includes(kind));
  const control = (field: ProviderField) => {
    if (field.type === "select") {
      return (
        <SelectInput
          placeholder={`Choose ${field.label.toLowerCase()}`}
          options={field.options.map((o) => o.label)}
          selection={field.options.find((o) => o.id === credential.settings[field.key])?.label ?? field.options[0]?.label ?? ""}
          onChange={(label) => setting(field.key, field.options.find((o) => o.label === label)?.id)}
        />
      );
    }
    if (field.secret || field.type === "password") {
      return <TextInput placeholder={isNew ? (field.placeholder ?? "") : "Stored. Paste a new one to replace it."} value={token} onChange={setToken} mono secure />;
    }
    return <TextInput placeholder={field.placeholder ?? ""} value={credential.settings[field.key] ?? ""} onChange={(v) => setting(field.key, v || undefined)} mono />;
  };
  return (
    <RecordPage
      active="Models"
      tab={paths.credential(isNew ? undefined : original.id)}
      title={heading}
      glyph="key"
      noun="credential"
      pending={pending}
      retry={retry}
      action={
        <FormActions
          save={isNew ? "Add credential" : "Save"}
          dirty={(changed || token !== "") && !isNew}
          archived={original.archived}
          saving={saving}
          cancel={back}
          onSave={() => actions.save?.(credential, token)}
          restore={() => actions.restore?.(original)}
        />
      }
      over={
        connection ? (
          <ConnectDialog connection={connection} provider={provider} actions={actions} credential={credential} />
        ) : removing && (
          <ConfirmDialog
            title={`Remove ${original.label}?`}
            message="It is removed for good, its token with it. Sessions that ran on it go on with the credential new sessions use."
            action="Remove credential"
            confirm={() => {
              actions.remove?.(original);
              setRemoving(false);
            }}
            cancel={() => setRemoving(false)}
          />
        )
      }
    >
      {original.archived && <Notice tone="blue" title={`${original.label} is archived`} text="Sessions cannot run on it. Sessions that ran on it keep their history." />}
      {errors.base && <Notice tone="red" title="The credential was not saved" text={errors.base} />}
      {/* An archived credential takes no edit until it is restored. */}
      <Enabled.Provider value={!original.archived}>
        <FormSection title="General" text="How this credential is named in the list.">
          {isNew && providers.length > 1 && (
            <Field label="Provider" required>
              <SelectInput
                placeholder="Choose a provider"
                options={providers.map((p) => p.label)}
                selection={credential.provider ? provider.label : ""}
                onChange={(label) => {
                  const next = providers.find((p) => p.label === label);
                  if (next) setCredential({ ...credential, provider: next.key, model: next.defaultModel, settings: { model: next.defaultModel } });
                }}
                clear={{ noun: "provider", message: "The credential has no provider until you choose one.", run: () => setCredential({ ...credential, provider: "", model: "", settings: {} }) }}
              />
            </Field>
          )}
          <Field label="Label" required error={errors.label}>
            <TextInput placeholder="Anthropic work" value={credential.label} onChange={(label) => setCredential({ ...credential, label })} error={!!errors.label} />
          </Field>
        </FormSection>
        <FormSection title="Access" text={`${provider.label}. The token is stored encrypted and never shown back.`}>
          {provider.fields.filter(asked).map((field) => (
            <Field key={field.key} label={field.label} required={!!field.required && (isNew || !field.secret)} help={field.help}>
              {control(field)}
            </Field>
          ))}
          {connected && (
            <Field label="ChatGPT account" help="You approve it in your browser with a code. h0 gets a login of its own: your own ChatGPT sessions are not shared or signed out.">
              <div className="flex items-center gap-3">
                {!isNew && <Pill text={credential.settings.account ? `Connected as ${credential.settings.account}` : "Connected"} tone="green" />}
                <Button kind={isNew ? "primary" : "secondary"} size="small" glyph="link" disabled={isNew && !credential.label.trim()} onClick={() => actions.connect?.(credential)}>
                  {isNew ? "Connect ChatGPT" : "Reconnect"}
                </Button>
              </div>
            </Field>
          )}
        </FormSection>
        {offered.length > 0 && (
          <FormSection title="Model" text="What new sessions on this credential run, unless their agent names another.">
            <Field label="Model" help={offered === provider.models ? "The vendor’s alias; it follows their current model." : "One of the models listed above."}>
              <SelectInput
                options={offered.map((m) => m.label)}
                selection={offered.find((m) => m.id === credential.model)?.label ?? (provider.defaultModel ? modelLabel(provider, credential.model) : "")}
                placeholder={byDefault}
                onChange={(label) => {
                  const m = offered.find((x) => x.label === label);
                  // A vendor with no alias to name has a default of its own: no model chosen.
                  setCredential({ ...credential, model: m?.id ?? "", settings: { ...credential.settings, model: m?.id ?? "" } });
                }}
              />
            </Field>
          </FormSection>
        )}
      </Enabled.Provider>
      {!isNew && (
        <FormFoot>
          {!original.archived && (
            <Button kind="tinted" size="small" glyph="archive" onClick={() => actions.archive?.(original)}>
              Archive
            </Button>
          )}
          <Button kind="tinted" tone="red" size="small" glyph="trash" onClick={() => setRemoving(true)}>
            Remove
          </Button>
        </FormFoot>
      )}
    </RecordPage>
  );
}

// The wait for a person's approval, in the form's overlay: the code and the page to enter it on, then how it ended.
function ConnectDialog({ connection, provider, credential, actions }: { connection: ConnectionModel; provider: ProviderModel; credential: CredentialModel; actions: CredentialActions }) {
  const failed = connection.state === "expired" || connection.state === "denied" || connection.state === "failed" || connection.state === "disabled";
  const titles: Record<ConnectionModel["state"], string> = {
    starting: "Connecting",
    pending: "Enter this code",
    connected: "Connected",
    expired: "The code expired",
    denied: "Sign-in denied",
    failed: "Connection failed",
    disabled: "Device login is off",
  };
  return (
    <Dialog
      title={titles[connection.state]}
      line={{ sub: `${provider.label} · ${credential.label || "ChatGPT"}` }}
      glyph="key"
      close={actions.cancelConnection}
      footer={
        <>
          <Button kind="secondary" size="small" onClick={actions.cancelConnection}>
            {connection.state === "connected" ? "Close" : failed ? "Close" : "Cancel"}
          </Button>
          {failed && connection.state !== "disabled" && (
            <Button kind="primary" size="small" glyph="link" onClick={() => actions.connect?.(credential)}>
              Try again
            </Button>
          )}
          {connection.state === "pending" && connection.verificationUrl && (
            <Button kind="primary" size="small" glyph="link" onClick={() => actions.openLink?.(connection.verificationUrl!)}>
              Open the page
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {connection.state === "starting" && <LoadingState text="Asking OpenAI for a code" />}
        {connection.state === "pending" && (
          <>
            <Field label="Code">
              <TextInput placeholder="" value={connection.userCode ?? ""} mono readOnly />
            </Field>
            <Field label="Page">
              <TextInput placeholder="" value={connection.verificationUrl ?? ""} mono readOnly />
            </Field>
            <Notice tone="blue" title="Waiting for your approval" text={`Open the page, sign in to ChatGPT and enter the code${connection.until ? `. It is valid until ${connection.until}` : ""}. This window closes when you approve.`} />
          </>
        )}
        {connection.state === "connected" && <Notice tone="green" title="ChatGPT is connected" text="The credential is saved and ready for new sessions." />}
        {failed && <Notice tone="red" title={titles[connection.state]} text={connection.reason ?? "Try again."} />}
      </div>
    </Dialog>
  );
}
