import { useState, type ReactNode } from "react";
import { Notice } from "../../conversation";
import { useDelayedBusy } from "../../busy";
import { Cell, CellText, GroupHead, RowMenu, SkeletonRows, TableRow } from "../../data";
import { FieldRow, FormList, FormFoot, FormSection, FormStep, ToggleRow } from "../../forms";
import { ConfirmDialog, PageHead } from "../../heads";
import { SelectInput, TextInput } from "../../inputs";
import { listEmpty, ListPage } from "../../lists";
import { menu } from "../../menu";
import { Button, Choice, Field, Item, LoadingState, Pill, Segments } from "../../primitives";
import { EmptyState, ErrorState } from "../../start";
import { fieldSize, type Tone } from "../../tokens";
import { useNavigate } from "../navigate";
import { paths } from "../routes";
import { SettingsShell } from "../shell";
import {
  codeFormat, codeLoad, environmentDetail, sandboxOption, type CodeError, type CodeFieldErrors, type CodeLoad, type DatabaseEngine, type DatabaseOption, type DraftCommand, type ProductionOption,
  type AccessMember, type DryRun, type EnvironmentDetail, type EnvironmentDraft, type PartialSave, type Repo, type SandboxOption,
} from "./models";
import { codeSamples } from "./samples";

const allRepositories = "All repositories";

export type EnvironmentsScreenProps = {
  repos?: CodeLoad<Repo[]>;
  environments?: CodeLoad<EnvironmentDetail[]>;
  options?: SandboxOption[];
  engines?: DatabaseEngine[];
  query?: string;
  // The repository name the filter starts on.
  repository?: string;
  // The id whose delete is being confirmed.
  deleting?: string;
  // The last dry run asked from this page.
  dryRun?: { environment: string; state: DryRun };
  onNew?: (r?: Repo) => void;
  onDelete?: (e: EnvironmentDetail) => void;
  onDryRun?: (e: EnvironmentDetail) => void;
  onRetry?: () => void;
};

// Environments by repository (`GET repos/{repo_id}/environments` for each repo): tier and size, branch, database,
// variables and commands. A row opens the environment's page; delete asks first (`DELETE environments/{id}`);
// a dry run starts from the row's menu (`POST environments/{id}/dry_run`) and its answer shows on top.
export function EnvironmentsScreen({
  repos = { loaded: codeSamples.repos }, environments = { loaded: codeSamples.environments }, options = codeSamples.options, engines = codeSamples.engines,
  query: initialQuery = "", repository: initialRepository, deleting: initialDeleting, dryRun, onNew = () => {}, onDelete = () => {}, onDryRun = () => {},
  onRetry,
}: EnvironmentsScreenProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState(initialQuery);
  const [repository, setRepository] = useState(initialRepository ?? allRepositories);
  const [menuOpen, setMenu] = useState<string>();
  const [deleting, setDeleting] = useState(initialDeleting);
  const list = codeLoad.value(environments) ?? [];
  const repoList = codeLoad.value(repos) ?? [];
  const repoName = (id: string) => repoList.find((r) => r.id === id)?.name ?? "";
  const q = query.trim().toLowerCase();
  const groups: [string, EnvironmentDetail[]][] = [];
  for (const e of list) {
    if (repository !== allRepositories && repoName(e.repoId) !== repository) continue;
    if (q && !e.name.toLowerCase().includes(q)) continue;
    const name = repoName(e.repoId);
    const group = groups.find(([n]) => n === name);
    if (group) group[1].push(e);
    else groups.push([name, [e]]);
  }
  const shown = groups.reduce((n, [, g]) => n + g.length, 0);
  const open = (e: EnvironmentDetail) => navigate(paths.environment(e.id), "here", e.name);

  const notice = (() => {
    const e = dryRun && list.find((x) => x.id === dryRun.environment);
    if (!dryRun || !e) return undefined;
    const state = dryRun.state;
    if (state === "starting") return <Notice tone="grey" text={`Starting a dry run of ${e.name} of ${repoName(e.repoId)}.`} />;
    if ("started" in state) {
      const s = state.started;
      return (
        <Notice
          tone="blue"
          title={`Dry run of ${e.name} started`}
          text={`Cloning on a fresh machine to ${s.worktree.branch}, then setup and the preview. The agent is not started.`}
          action="Open the dry run"
          perform={() => navigate(paths.session(s.id), "here", s.title)}
        />
      );
    }
    return <Notice tone="red" title={`No dry run of ${e.name}`} text={state.refused.error} />;
  })();

  const doomed = deleting ? list.find((e) => e.id === deleting) : undefined;
  return (
    <SettingsShell
      active="Environments"
      over={
        doomed && (
          <ConfirmDialog
            title={`Delete ${doomed.name} of ${repoName(doomed.repoId)}?`}
            message="Its variables, commands and checkouts go with it, with the sessions that ran on them."
            action="Delete environment"
            confirm={() => {
              onDelete(doomed);
              setDeleting(undefined);
            }}
            cancel={() => setDeleting(undefined)}
          />
        )
      }
    >
      <ListPage
        title="Environments"
        glyph="terminal"
        state={codeLoad.list(environments)}
        total={list.length}
        shown={shown}
        query={query}
        onQuery={setQuery}
        filtered={`${repository} has no environment.`}
        reset={() => setRepository(allRepositories)}
        empty={listEmpty("terminal", {
          noun: "environment",
          plural: "environments",
          text: "An environment says how a repository's checkouts run: the machine, the database, variables and commands.",
        })}
        retry={onRetry}
        filters={
          <div className="flex shrink-0" style={{ width: fieldSize.small.width }}>
            <SelectInput
              options={repoList.map((r) => r.name)}
              selection={repository === allRepositories ? "" : repository}
              placeholder={allRepositories}
              onChange={setRepository}
              glyph="repo"
              size="small"
              clear={{ noun: "repository filter", now: true, run: () => setRepository(allRepositories) }}
            />
          </div>
        }
        action={
          <Button
            kind="primary"
            size="small"
            glyph="plus"
            disabled={repoList.length === 0}
            onClick={() => onNew(repoList.find((r) => r.name === repository) ?? repoList[0])}
          >
            New environment
          </Button>
        }
        notice={notice}
        rows={
          <div className="flex flex-col items-stretch gap-7">
            {groups.map(([name, rows]) => (
              <div key={name} className="flex flex-col">
                <GroupHead title={name} count={rows.length} />
                {rows.map((e, i) => {
                  return (
                    <TableRow key={e.id} index={i} raised={menuOpen === e.id} action={() => open(e)} className="gap-4">
                      <Item
                        title={e.name}
                        line={{ sub: [e.branch, codeFormat.database(e.database, engines)].filter(Boolean).join(" · ") }}
                        lead={{ visual: "terminal" }}
                       
                      />
                      <CellText text={codeFormat.shape(e.shape, options, e.providerName)} width={140} />
                      <CellText text={String(e.vars.length)} width={40} kind="code" glyph="doc" />
                      <CellText text={String(e.commands.length)} width={40} kind="code" glyph="command" />
                      <Cell width={96} alignment="trailing">
                        {environmentDetail.health(e) && <Pill text={environmentDetail.health(e)![0]} tone={environmentDetail.health(e)![1]} />}
                      </Cell>
                      <RowMenu
                        label={`Actions for ${e.name}`}
                        open={menuOpen === e.id}
                        onOpenChange={(on) => setMenu(on ? e.id : undefined)}
                        entries={[
                          menu.item("Edit", { glyph: "gear", action: () => open(e) }),
                          menu.item("Dry run", { glyph: "preview", disabled: !environmentDetail.previews(e), action: () => onDryRun(e) }),
                          menu.divider,
                          menu.item("Delete", { glyph: "trash", destructive: true, action: () => setDeleting(e.id) }),
                        ]}
                      />
                    </TableRow>
                  );
                })}
              </div>
            ))}
          </div>
        }
      />
    </SettingsShell>
  );
}

export type EnvironmentScreenProps = {
  name: string;
  load: CodeLoad<EnvironmentDetail>;
  back?: () => void;
  retry?: () => void;
  form: (e: EnvironmentDetail) => ReactNode;
};

// The page of an environment: the environment loading, its error, or its form.
export function EnvironmentScreen({ name, load, back, retry, form }: EnvironmentScreenProps) {
  const e = codeLoad.value(load);
  const failure = codeLoad.failure(load);
  const held = useDelayedBusy(!e && !failure, !!failure);
  if (e && !held) return <>{form(e)}</>;
  return (
    <SettingsShell active="Environments" tab={paths.environment("")} tabTitle={name} head={<PageHead title={name} glyph="terminal" back={paths.settings("environments")} />}>
      {failure?.code === "not_found" ? (
        <EmptyState
          glyph="terminal"
          title="This environment is gone"
          text={failure.error}
          action={
            <Button size="small" onClick={back}>
              Back to environments
            </Button>
          }
        />
      ) : failure ? (
        <ErrorState title="The environment did not load" message={failure.error} retry={retry} />
      ) : (
        <LoadingState text={`Loading ${name}`} />
      )}
    </SettingsShell>
  );
}

// What the environment form shows over itself.
export type EnvironmentFormOverlay = "none" | "purge" | "delete";

export type EnvironmentFormProps = {
  // Without it, the form makes one in `repo` (`POST repos/{repo_id}/environments`).
  environment?: EnvironmentDetail;
  repos?: Repo[];
  repo?: string;
  options?: CodeLoad<SandboxOption[]>;
  engines?: CodeLoad<DatabaseEngine[]>;
  // The databases a production environment picks from.
  databaseOptions?: DatabaseOption[];
  // The servers a production environment runs on.
  productionOptions?: ProductionOption[];
  // The workspace's members, for who may reach it (the Access tab).
  members?: AccessMember[];
  // A 422's fields.
  errors?: CodeFieldErrors;
  // A 422's `{ error, code }`, or any other refusal.
  refusal?: CodeError;
  // A save whose general fields went through before a variable or a command was refused.
  partial?: PartialSave;
  // A save was accepted after the checkouts (202).
  purging?: boolean;
  saving?: boolean;
  dryRun?: DryRun;
  overlay?: EnvironmentFormOverlay;
  // The header tab the form opens on (`sections`).
  section?: (typeof sections)[number];
  // The tab changed: a page that starts the form again after a save passes it back as `section`.
  onSection?: (section: (typeof sections)[number]) => void;
  // The last save went through, whole.
  saved?: boolean;
  onSave?: (draft: EnvironmentDraft) => void;
  onPurge?: (draft: EnvironmentDraft) => void;
  onDryRun?: () => void;
  onDelete?: () => void;
  back?: () => void;
  retry?: () => void;
};

const kinds = ["setup", "preview", "default"];
const sections = ["General", "Database", "Variables", "Setup", "Preview", "Commands", "Access"] as const;

// The form's first draft from the environment, or a new one's defaults: the first option that is not on request, its disk,
// the repository's default branch.
export function environmentDraft(e: EnvironmentDetail | undefined, repo: Repo | undefined, repoId: string, options: SandboxOption[]): EnvironmentDraft {
  const option = (e && sandboxOption.of(options, e.providerName, e.shape)) ?? options.find((o) => !o.onRequest);
  const shape = e?.shape ?? (option ? sandboxOption.shape(option) : "");
  const disk = e?.disk ?? option?.disk?.default ?? 0;
  const commands = [...(e?.commands ?? [])].sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || a.position - b.position);
  return {
    repoId,
    name: e?.name ?? "",
    providerName: e?.providerName ?? option?.provider ?? "",
    shape,
    disk,
    branch: e?.branch ?? repo?.defaultBranch ?? "",
    previewPort: e?.previewPort !== undefined ? String(e.previewPort) : "",
    databaseEngine: e?.database?.engine,
    databaseVersion: e?.database?.version,
    databaseOption: e?.database?.option,
    vars: (e?.vars ?? []).map((v) => ({ key: v.key, value: v.value ?? "", secret: v.secret, saved: v.key, hidden: v.value === undefined })),
    removedVars: [],
    commands: commands.map((c) => ({ id: c.id, kind: c.kind, name: c.name, command: c.command, port: c.port !== undefined ? String(c.port) : "", before: c.before.join("\n") })),
    removedCommands: [],
    restricted: e?.restricted ?? false,
    memberIds: e?.memberIds ?? [],
  };
}

// A worktree state as a word and a tone.
function worktreeWord(state: string): [string, Tone] {
  switch (state) {
    case "starting":
      return ["Starting", "orange"];
    case "running":
      return ["Running", "green"];
    case "paused":
      return ["Paused", "grey"];
    case "failed":
      return ["Failed", "red"];
    default:
      return ["New", "grey"];
  }
}

const capital = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);

// One environment as a full-page form, or a new one: name and branch, the machine from the options on offer, the
// preview port, the database from the engines on offer, variables, and setup, preview and other commands as
// step blocks. A secret's value never comes back. Saving what checkouts run on while some exist is refused
// (422 `checkouts`); the purge deletes them and saves after (202).
export function EnvironmentForm({
  environment, repos = codeSamples.repos, repo, options = { loaded: codeSamples.options }, engines = { loaded: codeSamples.engines }, databaseOptions = codeSamples.databaseOptions, productionOptions = codeSamples.productionOptions, members = codeSamples.members, errors = {}, refusal,
  partial, purging = false, saving = false, dryRun, overlay: initialOverlay = "none", section: initialSection, onSection, saved = false, onSave = () => {}, onPurge = () => {}, onDryRun, onDelete = () => {},
  back, retry,
}: EnvironmentFormProps) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<EnvironmentDraft>(() => {
    const repoId = environment?.repoId ?? repo ?? repos[0]?.id ?? "";
    const d = environmentDraft(environment, repos.find((r) => r.id === repoId), repoId, codeLoad.value(options) ?? []);
    // A created environment opens with what its first save left unsaved.
    if (partial?.created) {
      d.vars = partial.vars ?? [];
      d.commands = [...d.commands, ...(partial.commands ?? [])];
    }
    return d;
  });
  const [overlay, setOverlay] = useState<EnvironmentFormOverlay>(initialOverlay);
  // A created environment whose variables were refused opens where they wait to be saved again.
  const [section, setSection] = useState<number>(sections.indexOf(initialSection ?? (partial?.created && partial.vars?.length ? "Variables" : "General")));
  const change = (patch: Partial<EnvironmentDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const optionList = codeLoad.value(options) ?? [];
  const engineList = codeLoad.value(engines) ?? [];
  // The draft's option when the site offers it; an environment on a size no longer offered has none selected.
  const option = sandboxOption.of(optionList, draft.providerName, draft.shape);
  const offered = !!option || draft.providerName === "";
  const title = environment?.name ?? "New environment";

  // A field's first error, with its name: "Preview port must be in 1..65535".
  const error = (field: string) => {
    const message = errors[field]?.[0];
    return message ? `${capital(field.replace(/_/g, " "))} ${message}` : undefined;
  };

  const banner = (() => {
    if (refusal?.code === "checkouts") {
      // The purge asks first, on a danger button.
      return <Notice tone="orange" title="Nothing was saved" text={refusal.error} action="Delete checkouts and save" perform={() => setOverlay("purge")} />;
    }
    if (partial?.created) {
      const left = (partial.vars?.length ?? 0) + (partial.commands?.length ?? 0);
      return (
        <Notice
          tone="red"
          title="Partly saved"
          text={`The environment was created; ${partial.failed} was not saved, nor what came after it. ${partial.error.error} ${left === 0 ? "Add them again and save." : "They are filled in below; save again."}`}
        />
      );
    }
    if (partial) {
      return (
        <Notice
          tone="red"
          title="Partly saved"
          text={`The general fields were saved; ${partial.failed} was not. ${partial.error.error} Save again to retry it and what came after it.`}
        />
      );
    }
    if (refusal) return <Notice tone="red" title="Nothing was saved" text={refusal.error} />;
    if (Object.keys(errors).length) return <Notice tone="red" title="Nothing was saved" text="Fix the fields marked below, then save again." />;
    if (purging) {
      return (
        <Notice
          tone="blue"
          title="Saved after the checkouts"
          text="Its checkouts are being deleted. The tier, size, disk, branch and database change once they are gone."
        />
      );
    }
    if (saved) return <Notice tone="green" title="Saved" text="The environment's changes are saved." />;
    return null;
  })();

  // The dry run started from the header, or its refusal, above whichever tab is open.
  const dryNotice = (() => {
    if (!dryRun || dryRun === "starting") return null;
    if ("refused" in dryRun) return <Notice tone="red" title="No dry run" text={dryRun.refused.error} />;
    const s = dryRun.started;
    const [word, tone] = worktreeWord(s.worktree.state);
    return (
      <TableRow index={0} className="gap-4">
        <Item title={s.worktree.branch} line={{ sub: `Dry run started ${codeFormat.time(s.createdAt) ?? ""}` }} lead={{ visual: "terminal" }} />
        <Button size="small" onClick={() => navigate(paths.session(s.id), "here", s.title)}>
          Open the dry run
        </Button>
        <Pill text={word} tone={tone} />
      </TableRow>
    );
  })();

  const general = (
    <FormSection title="General" text={environment?.kind === "production" ? "What the repositories page calls it, and the branch it deploys." : "What sessions and the repositories page call it, and what its checkouts are cut from."}>
      <div className="flex flex-col items-stretch gap-4">
        {environment?.health && environment.health.status !== "ok" && (
          <Notice
            tone={environment.health.status === "down" ? "red" : "orange"}
            title={`Production is ${environment.health.status}`}
            text={environment.health.reasons.join(". ")}
          />
        )}
        {!environment && (
          <Field label="Repository" required>
            <SelectInput
              placeholder="Choose a repository"
              options={repos.map((r) => r.name)}
              selection={repos.find((r) => r.id === draft.repoId)?.name ?? ""}
              onChange={(n) => change({ repoId: repos.find((r) => r.name === n)?.id ?? draft.repoId })}
              glyph="repo"
              manage={{ noun: "repositories", glyph: "repo", page: "repositories" }}
              clear={{ noun: "repository", message: "The environment belongs to no repository until you choose one.", run: () => change({ repoId: "" }) }}
            />
          </Field>
        )}
        <FieldRow>
          <Field label="Name" required help="Lower-case letters, digits and dashes." error={error("name")}>
            <TextInput placeholder="development" handle="name" value={draft.name} onChange={(name) => change({ name })} mono error={!!error("name")} />
          </Field>
          <Field label="Branch" help={environment?.kind === "production" ? "What a ship into it deploys." : "What a checkout is made from."} error={error("branch")}>
            <TextInput placeholder="main" value={draft.branch} onChange={(branch) => change({ branch })} mono error={!!error("branch")} glyph="branch" />
          </Field>
        </FieldRow>
      </div>
    </FormSection>
  );

  const machine = (
    <FormSection title="Machine" text="Where its checkouts run, and how big each machine is.">
      {options === "loading" ? (
        <SkeletonRows count={2} />
      ) : "failed" in options ? (
        <ErrorState title="Sizes did not load" message={options.failed.error} retry={retry} />
      ) : (
        <div className="flex flex-col items-stretch gap-4">
          {!offered && (
            <Notice
              tone="grey"
              title="Size no longer offered"
              text={`It runs on ${codeFormat.shape(draft.shape, optionList, draft.providerName)}, which the site no longer offers. Pick a size to move it; until then it stays as it is.`}
            />
          )}
          <Field label="Size" help="What each machine gets, and what it costs while it runs." error={error("option")}>
            <div className="grid auto-cols-fr grid-flow-col items-stretch gap-2">
              {optionList.map((o) => (
                <Choice
                  key={o.label}
                  title={o.label}
                  detail={`${o.cpu} vCPU · ${o.memory} GB\n${o.onRequest ? "On request" : o.price !== undefined ? codeFormat.rate(o.price, o.currency) : ""}`}
                  selected={option?.label === o.label}
                  disabled={o.onRequest}
                  onClick={() => change({ providerName: o.provider, shape: sandboxOption.shape(o), disk: o.disk && sandboxOption.disks(o).includes(draft.disk) ? draft.disk : (o.disk?.default ?? draft.disk) })}
                />
              ))}
            </div>
          </Field>
          {option?.disk && (
            <Field label="Disk" help="Included, whatever you pick." error={error("disk")} className="w-[360px]">
              <SelectInput
                placeholder="Choose a disk size"
                options={sandboxOption.disks(option).map((n) => `${n} GB`)}
                selection={`${draft.disk} GB`}
                onChange={(v) => change({ disk: Number(v.split(" ")[0]) || draft.disk })}
                clear={{ noun: "disk", message: "The environment has no disk size until you choose one.", run: () => change({ disk: 0 }) }}
              />
            </Field>
          )}
        </div>
      )}
    </FormSection>
  );

  const production = environment?.kind === "production";
  const servers = (
    <FormSection title="Servers" text="What its cluster runs on, and what each server costs while it runs.">
      <Field label="Option">
        <div className="grid auto-cols-fr grid-flow-col items-stretch gap-2">
          {productionOptions.map((o) => (
            <Choice key={o.label} title={o.label} detail={codeFormat.productionOption(o)} selected={environment?.option === o.label} disabled />
          ))}
        </div>
      </Field>
    </FormSection>
  );

  const database = (
    <FormSection
      title="Database"
      text={production ? "One database of its own for this environment; it is never branched." : "Outside the machine; each checkout gets its own copy, and every command its address as DATABASE_URL."}
    >
      {production ? (
        <Field label="Database" help="It cannot change once made." error={error("database")}>
          <div className="grid auto-cols-fr grid-flow-col items-stretch gap-2">
            {databaseOptions.map((o) => (
              <Choice
                key={o.label}
                title={o.label}
                detail={codeFormat.databaseOption(o)}
                selected={draft.databaseOption === o.label}
                disabled={o.onRequest}
                onClick={() => change({ databaseOption: o.label })}
              />
            ))}
          </div>
        </Field>
      ) : engines === "loading" ? (
        <SkeletonRows count={1} />
      ) : "failed" in engines ? (
        <ErrorState title="Engines did not load" message={engines.failed.error} retry={retry} />
      ) : (
        <div className="flex flex-col items-stretch gap-4">
          <Field label="Engine" error={error("database")}>
            <div className="grid auto-cols-fr grid-flow-col items-stretch gap-2">
              <Choice
                title="None"
                detail="No managed database."
                selected={draft.databaseEngine === undefined}
               
                onClick={() => change({ databaseEngine: undefined, databaseVersion: undefined })}
              />
              {engineList.map((e) => (
                <Choice
                  key={e.name}
                  title={e.label}
                  detail={e.versions.length > 1 ? `Versions ${e.versions[0]} to ${e.versions[e.versions.length - 1]}.` : `${e.versions[0] ?? ""}.`}
                  selected={draft.databaseEngine === e.name}
                  onClick={() => change({ databaseEngine: e.name, databaseVersion: e.defaultVersion })}
                />
              ))}
            </div>
          </Field>
          {(() => {
            const engine = engineList.find((e) => e.name === draft.databaseEngine);
            if (!engine || engine.versions.length <= 1) return null;
            return (
              <Field label="Version" className="w-[360px]">
                <SelectInput placeholder="Choose a version" options={engine.versions} selection={draft.databaseVersion ?? engine.defaultVersion} onChange={(v) => change({ databaseVersion: v })} />
              </Field>
            );
          })()}
          {environment?.database && (
            <TableRow index={0}>
              <Item
                title={codeFormat.database(environment.database, engineList) ?? environment.database.engine}
                line={{ sub: environment.database.ready ? "Made. Each checkout takes its own copy." : "The vendor has not made it yet." }}
                lead={{ visual: "server" }}
                size="small"
               
                trailing={<Pill text={environment.database.ready ? "Ready" : "Not made yet"} tone={environment.database.ready ? "green" : "grey"} />}
              />
            </TableRow>
          )}
        </div>
      )}
    </FormSection>
  );

  const setVar = (i: number, patch: Partial<EnvironmentDraft["vars"][number]>) =>
    setDraft((d) => ({ ...d, vars: d.vars.map((v, n) => (n === i ? { ...v, ...patch } : v)) }));
  const removeVar = (i: number) =>
    setDraft((d) => {
      const v = d.vars[i];
      if (!v) return d;
      return { ...d, vars: d.vars.filter((_, n) => n !== i), removedVars: v.saved ? [...d.removedVars, v.saved] : d.removedVars };
    });

  const variables = (
    <FormSection title="Variables" text="Reach the app's processes. The agent is told the names, never the values.">
      <FormList
        data={draft.vars.map((_, i) => i)}
        id={(i) => i}
        add="Add a variable"
        onAdd={() => change({ vars: [...draft.vars, { key: "", value: "", secret: false }] })}
        row={(i) => {
          const v = draft.vars[i];
          return (
            <FormStep
              title={v.key || "New variable"}
              line={v.secret ? { sub: "Secret" } : v.value ? { sub: v.value } : undefined}
              lead={{ visual: v.secret ? "secret" : "env" }}
              remove={() => removeVar(i)}
            >
              <div className="flex flex-col items-stretch gap-3">
                <div className="flex items-start gap-3">
                  <Field label="Key" className="w-[360px] shrink-0">
                    <TextInput placeholder="STRIPE_SECRET_KEY" value={v.key} onChange={(key) => setVar(i, { key: key.toUpperCase() })} mono />
                  </Field>
                  <Field label="Value" help={v.hidden ? "Saved and hidden. Type to replace it." : undefined} className="min-w-0 flex-1">
                    <TextInput placeholder={v.hidden ? "••••••••" : "sk_test_…"} value={v.value} onChange={(value) => setVar(i, { value })} mono />
                  </Field>
                </div>
                <ToggleRow title="Secret" line={{ sub: "Hidden on this page once saved." }} on={v.secret} onChange={(secret) => setVar(i, { secret })} />
              </div>
            </FormStep>
          );
        }}
      />
    </FormSection>
  );

  const setCommand = (i: number, patch: Partial<DraftCommand>) =>
    setDraft((d) => ({ ...d, commands: d.commands.map((c, n) => (n === i ? { ...c, ...patch } : c)) }));
  const removeCommand = (i: number) =>
    setDraft((d) => {
      const c = d.commands[i];
      if (!c) return d;
      return { ...d, commands: d.commands.filter((_, n) => n !== i), removedCommands: c.id ? [...d.removedCommands, c.id] : d.removedCommands };
    });
  // Moves one command of a kind to another's place; the other kinds keep their rows.
  const sortCommands = (indices: number[], from: number, to: number) =>
    setDraft((d) => {
      const ordered = indices.map((i) => d.commands[i]);
      const [moved] = ordered.splice(from, 1);
      ordered.splice(to, 0, moved);
      const commands = [...d.commands];
      indices.forEach((slot, n) => (commands[slot] = ordered[n]));
      return { ...d, commands };
    });

  const commands = (sectionTitle: string, text: string, kind: string, glyph: string, add: string) => {
    const indices = draft.commands.flatMap((c, i) => (c.kind === kind ? [i] : []));
    return (
      <FormSection title={sectionTitle} text={text}>
        <FormList
          data={indices}
          id={(i) => i}
          add={add}
          onAdd={() => change({ commands: [...draft.commands, { kind, name: "", command: "", port: "", before: "" }] })}
          onSort={kind === "default" ? undefined : (from, to) => sortCommands(indices, from, to)}
          row={(i, n) => {
            const c = draft.commands[i];
            return (
              <FormStep
                title={c.name || "New command"}
                line={c.command ? { sub: c.command } : undefined}
                lead={kind === "setup" ? { number: String(n + 1) } : { visual: glyph }}
                remove={() => removeCommand(i)}
              >
                <div className="flex flex-col items-stretch gap-3">
                  <div className="flex items-start gap-3">
                    <Field label="Name" className="w-[160px] shrink-0">
                      <TextInput placeholder="migrate" value={c.name} onChange={(name) => setCommand(i, { name })} />
                    </Field>
                    <Field label="Command" className="min-w-0 flex-1">
                      <TextInput placeholder="bin/rails db:migrate" value={c.command} onChange={(command) => setCommand(i, { command })} mono />
                    </Field>
                    {kind === "preview" && (
                      <Field label="Port" className="w-[96px] shrink-0">
                        <TextInput placeholder="3000" value={c.port} onChange={(port) => setCommand(i, { port })} mono />
                      </Field>
                    )}
                  </div>
                  {kind === "preview" && (
                    <Field label="Before" help="Commands run first, one per line, under a lock and with retries.">
                      <TextInput placeholder="bin/rails db:prepare" value={c.before} onChange={(before) => setCommand(i, { before })} mono rows={2} />
                    </Field>
                  )}
                </div>
              </FormStep>
            );
          }}
        />
      </FormSection>
    );
  };

  // Who reaches it: everyone, or the admins and the members named. Only a saved environment can be restricted.
  const admitted = (id: string, on: boolean) =>
    change({ memberIds: on ? [...draft.memberIds, id] : draft.memberIds.filter((x) => x !== id) });
  const others = members.filter((m) => m.you || m.role !== "admin");
  const access = (
    <>
      <FormSection title="Who can reach it" text="Everyone in the workspace reaches an environment and the sessions on it, unless it is restricted. Admins always do.">
        <ToggleRow
          title="Restrict to some members"
          line={{ sub: "Only the members below see it, start sessions on it or find them in search." }}
          on={draft.restricted}
          onChange={(restricted) => change({ restricted })}
        />
      </FormSection>
      {draft.restricted && (
        <FormSection title="Members" text="Who else reaches it, besides the admins. You see the members you control.">
          {others.length === 0 ? (
            <Notice text="Nobody else is in this workspace yet." tone="grey" />
          ) : (
            others.map((m) => (
              <ToggleRow
                key={m.id}
                title={m.name ?? m.email}
                line={{ sub: [m.you && "You", capital(m.role), m.name && m.email].filter(Boolean).join(" · ") }}
                on={m.you || draft.memberIds.includes(m.id)}
                disabled={m.you}
                onChange={(on) => admitted(m.id, on)}
              />
            ))
          )}
        </FormSection>
      )}
    </>
  );

  const preview = (
    <FormSection title="Preview" text="Its commands start together when somebody opens the preview, and stay up. The preview shows this port.">
      <Field label="Port" help="The port your app listens on inside the machine." error={error("preview_port")} className="w-[360px]">
        <TextInput placeholder="3000" value={draft.previewPort} onChange={(previewPort) => change({ previewPort })} mono error={!!error("preview_port")} />
      </Field>
    </FormSection>
  );

  let body: ReactNode;
  switch (sections[section]) {
    case "Database":
      body = database;
      break;
    case "Variables":
      body = variables;
      break;
    case "Setup":
      body = commands("Setup commands", "Run once after the clone, in this order, and exit.", "setup", "setup", "Add a setup command");
      break;
    case "Preview":
      body = (
        <>
          {preview}
          {commands("Preview commands", "Start together when somebody opens the preview, and stay up.", "preview", "preview", "Add a preview command")}
        </>
      );
      break;
    case "Access":
      body = access;
      break;
    case "Commands":
      body = commands("Commands", "Stored, and run when somebody presses them.", "default", "run", "Add a command");
      break;
    default:
      body = (
        <>
          {general}
          {production ? servers : machine}
          {environment && (
            <FormFoot>
              <Button kind="tinted" tone="red" size="small" glyph="trash" onClick={() => setOverlay("delete")}>
                {`Delete ${environment.name}`}
              </Button>
            </FormFoot>
          )}
        </>
      );
  }

  const previews = environment ? environmentDetail.previews(environment) : false;
  // A production environment has no machine: no setup, no preview.
  const shown = sections.filter((s) => (environment || s !== "Access") && !(production && (s === "Setup" || s === "Preview")));
  const head = (
    <PageHead
      title={title}
      glyph="terminal"
      state={environment && environmentDetail.health(environment)}
      center={<Segments items={shown} selection={Math.max(0, shown.indexOf(sections[section]))} onChange={(i) => { setSection(sections.indexOf(shown[i])); onSection?.(shown[i]); }} />}
      action={
        <div className="flex items-center gap-2">
          {environment && !production && (
            <span
              className="inline-flex"
              title={
                previews
                  ? `Clones ${environment.branch} on a fresh machine and runs setup and the preview, as a new session would. The agent is not started.`
                  : "A dry run starts the preview, so it needs a preview command. Add one under Preview, then save."
              }
            >
              <Button size="small" glyph="preview" loading={dryRun === "starting"} disabled={!previews} onClick={onDryRun}>
                Dry run
              </Button>
            </span>
          )}
          <Button size="small" onClick={back}>
            Cancel
          </Button>
          <Button kind="primary" size="small" loading={saving} onClick={() => onSave(draft)}>
            {environment ? "Save" : "Create environment"}
          </Button>
        </div>
      }
    />
  );

  let over: ReactNode = null;
  if (overlay === "purge") {
    over = (
      <ConfirmDialog
        title="Delete the checkouts and save?"
        message={`${refusal?.error ?? ""} Their machines, their database copies and their sessions go with them. Work not pushed is lost.`}
        action="Delete checkouts and save"
        confirm={() => {
          onPurge(draft);
          setOverlay("none");
        }}
        cancel={() => setOverlay("none")}
      />
    );
  } else if (overlay === "delete") {
    over = (
      <ConfirmDialog
        title={`Delete ${title}?`}
        message="Its variables, commands and checkouts go with it, with the sessions that ran on them."
        action="Delete environment"
        confirm={() => {
          onDelete();
          setOverlay("none");
        }}
        cancel={() => setOverlay("none")}
      />
    );
  }

  return (
    <SettingsShell
      active="Environments"
      tab={environment ? paths.environment(environment.id) : paths.newEnvironment()}
      tabTitle={environment?.name}
      head={head}
      over={over}
    >
      <div className="flex flex-col items-stretch gap-10">
        {banner}
        {dryNotice}
        {body}
      </div>
    </SettingsShell>
  );
}
