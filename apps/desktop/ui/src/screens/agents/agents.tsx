import { Enabled } from "../../clickable";
import { useState } from "react";
import { Cell, CellText, ColumnHeads, RowMenu, TableRow } from "../../data";
import { FieldRow, FormActions, FormFoot, FormSection, ToggleRow } from "../../forms";
import { SelectInput, TextInput } from "../../inputs";
import { listEmpty, ListPage } from "../../lists";
import { menu } from "../../menu";
import { Button, Field, GroupTitle, Item, Segments, Tag } from "../../primitives";
import { EmptyState } from "../../start";
import { Notice } from "../../conversation";
import { useNavigate } from "../navigate";
import { paths } from "../routes";
import { SettingsShell } from "../shell";
import { agentModels, byDefault, byMain, fetched, matching, optionLabel, toolCategories, toolLevels, type AgentModel, type AgentToolModel, type CredentialOption, type FieldErrors, type Fetched, type ModelOption, type SkillModel } from "./models";
import { RecordPage, useAgentTabs, useDraft, type Pending } from "./parts";
import { agentsSamples } from "./samples";

// What the agents pages ask the app to do.
export type AgentActions = {
  showArchived?: (on: boolean) => void;
  retry?: () => void;
  // An agent with an empty id is new: `POST agents`; otherwise `PATCH agents/{id}`.
  save?: (agent: AgentModel) => void;
  archive?: (agent: AgentModel) => void;
  restore?: (agent: AgentModel) => void;
};

const capital = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);

// The workspace's agents: name and tagline, the model each runs, how many of the tools (`agents/tools`) it may use.
// A row opens the agent's page in the tab.
export function AgentsScreen({
  state, models = agentsSamples.provider.models, tools = agentsSamples.agentTools, archived: initial = false, anyArchived = false, query: initialQuery = "", actions = {},
}: { state: Fetched<AgentModel[]>; models?: ModelOption[]; tools?: AgentToolModel[]; archived?: boolean; anyArchived?: boolean; query?: string; actions?: AgentActions }) {
  const [query, setQuery] = useState(initialQuery);
  const [archived, setArchived] = useState(initial);
  const [open, setOpen] = useState<string>();
  const navigate = useNavigate();
  const tabs = useAgentTabs("agents");
  const all = fetched.value(state) ?? [];
  const kept = matching(all, query, (a) => a.name);
  const edit = (a: AgentModel) => navigate(paths.agent(a.id), "here", a.name);
  return (
    <SettingsShell active="Agents">
      <ListPage
        tabs={tabs}
        title="Agents"
        glyph="bot"
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
        empty={listEmpty("bot", { noun: "agent", plural: "agents", text: "An agent is a named set of instructions and tools. Create one to start." })}
        retry={actions.retry}
        action={
          <Button kind="primary" size="small" glyph="plus" onClick={() => navigate(paths.agent(), "here", "New agent")}>
            New agent
          </Button>
        }
        rows={
          <div className="flex flex-col">
            <ColumnHeads columns={[["Agent", null], ["Tools", 90], ["Model", 150, "trailing"], ["", 28, "trailing"]]} />
            {kept.map((a, i) => (
              <TableRow key={a.id} index={i} raised={open === a.id} action={() => edit(a)}>
                <div className="flex w-full items-center gap-4">
                  <Item title={a.name} line={a.tagline ? { sub: a.tagline } : undefined} lead={{ visual: "bot" }} />
                  <CellText text={`${agentModels.granted(a, tools)} of ${tools.length}`} width={90} />
                  <Cell width={150} alignment="trailing">
                    <Tag text={models.find((m) => m.id === a.model)?.label ?? byDefault} size="small" />
                  </Cell>
                  <RowMenu
                    label={`Actions for ${a.name}`}
                    open={open === a.id}
                    onOpenChange={(on) => setOpen(on ? a.id : undefined)}
                    entries={
                      a.archived
                        ? [menu.item("Restore", { glyph: "restore", action: () => actions.restore?.(a) })]
                        : [menu.item("Edit", { glyph: "gear", action: () => edit(a) }), menu.divider, menu.item("Archive", { glyph: "archive", destructive: true, action: () => actions.archive?.(a) })]
                    }
                  />
                </div>
              </TableRow>
            ))}
          </div>
        }
      />
    </SettingsShell>
  );
}

export type AgentFormProps = {
  agent: AgentModel;
  models?: ModelOption[];
  // The tools it sets a level for (`agents/tools`), by category.
  tools?: AgentToolModel[];
  // The live credentials it may name; with none, the field is left out.
  credentials?: CredentialOption[];
  skills?: SkillModel[];
  errors?: FieldErrors;
  saving?: boolean;
  // Set while the record is coming, or did not come; `agent.name` heads the page.
  pending?: Pending;
  retry?: () => void;
  actions?: AgentActions;
  back?: () => void;
};

// One agent as a full page: its name, tagline, model and instructions, a level per tool, its skills.
export function AgentForm({ agent: original, models = agentsSamples.provider.models, tools: allTools = agentsSamples.agentTools, credentials = agentsSamples.credentialOptions, skills = agentsSamples.skills, errors = {}, saving, pending, retry, actions = {}, back }: AgentFormProps) {
  const [agent, setAgent, changed] = useDraft(original);
  const isNew = !original.id;
  const heading = pending || !isNew ? original.name : "New agent";
  const set = (patch: Partial<AgentModel>) => setAgent({ ...agent, ...patch });
  // A built-in its runner lacks is no tool of the agent (`AgentResource#absent`).
  const tools = allTools.filter((t) => !agent.absent.includes(t.name));
  const unguarded = agentModels.unguarded(agent, tools);
  let index = 0;
  // Its models are the ones its credential's vendor offers; with the workspace's main, every vendor's.
  const credential = credentials.find((c) => c.id === agent.llmConfigId);
  const offered = credential ? credential.models : models;
  return (
    <RecordPage
      active="Agents"
      tab={paths.agent(isNew ? undefined : original.id)}
      title={heading}
      glyph="bot"
      noun="agent"
      pending={pending}
      retry={retry}
      action={
        <FormActions
          save={isNew ? "Create agent" : "Save"}
          dirty={changed && !isNew}
          archived={original.archived}
          saving={saving}
          cancel={back}
          onSave={() => actions.save?.(agent)}
          restore={() => actions.restore?.(original)}
        />
      }
    >
      {original.archived && <Notice tone="blue" title={`${original.name} is archived`} text="Sessions that ran on it keep their history. Restore it to start new ones." />}
      {/* An archived agent takes no edit until it is restored. */}
      <Enabled.Provider value={!original.archived}>
        <FormSection title="General" text="Its name, what it is for, the model it runs and how it works.">
          <FieldRow>
            <Field label="Name" required error={errors.name}>
              <TextInput placeholder="Reviewer" value={agent.name} onChange={(name) => set({ name })} error={!!errors.name} />
            </Field>
            <Field label="Tagline" help="One line, shown under the name in the list." error={errors.tagline}>
              <TextInput placeholder="Reads a diff and leaves notes" value={agent.tagline ?? ""} onChange={(t) => set({ tagline: t || undefined })} />
            </Field>
          </FieldRow>
          {credentials.length > 0 && (
            <Field label="Model credential" help="The account its new sessions run on, and so Claude Code or Codex. Sessions already started keep theirs." error={errors.llmConfig}>
              <SelectInput
                options={credentials.map(optionLabel)}
                selection={credential ? optionLabel(credential) : ""}
                placeholder={byMain}
                onChange={(label) => {
                  const next = credentials.find((c) => optionLabel(c) === label);
                  const keeps = !agent.model || (next ? next.models : models).some((m) => m.id === agent.model);
                  set({ llmConfigId: next?.id, model: keeps ? agent.model : undefined });
                }}
                manage={{ noun: "models", glyph: "key", page: "credentials" }}
                clear={{ noun: "model credential", message: "New sessions run on the workspace’s main credential again.", run: () => set({ llmConfigId: undefined }) }}
              />
            </Field>
          )}
          <Field label="Model" help="A vendor’s alias. The default runs whatever the session’s credential is set to." error={errors.model}>
            <SelectInput
              options={offered.map((m) => m.label)}
              selection={offered.find((m) => m.id === agent.model)?.label ?? ""}
              placeholder={byDefault}
              onChange={(label) => set({ model: offered.find((m) => m.label === label)?.id })}
              clear={{ noun: "model", message: "The agent runs whatever its session’s credential is set to.", run: () => set({ model: undefined }) }}
            />
          </Field>
          <Field label="Instructions" help="Markdown. The model reads it at the start of every session." error={errors.instructions}>
            <TextInput placeholder="Run the tests before you push. Say which ones you ran." value={agent.instructions} onChange={(instructions) => set({ instructions })} rows={8} />
          </Field>
        </FormSection>
        {unguarded.length > 0 && (
          <Notice
            tone="orange"
            title="Data can leave without an approval"
            text={
              "This agent reads content nobody here wrote, such as web pages and issue bodies, and runs " +
              `${unguarded.map((t) => t.label).join(" and ")} at auto. Instructions hidden in that content could send ` +
              `your code out with nobody approving. Set ${unguarded.length === 1 ? "it" : "them"} to approval.`
            }
          />
        )}
        <FormSection title="Tools" text="Auto runs, approval asks you first, deny hides the tool.">
          <div className="flex flex-col gap-6">
            {toolCategories(tools).map((category) => {
              const rows = tools.filter((t) => t.category === category);
              return (
                <div key={category} className="flex flex-col">
                  <GroupTitle title={category} count={rows.length} />
                  {rows.map((tool) => {
                    const levels = toolLevels(tool);
                    return (
                      <TableRow key={tool.name} index={index++}>
                        <div className="flex w-full items-center gap-4">
                          <Item title={tool.label} line={{ sub: tool.name }} monoSub />
                          <Segments
                            items={levels.map(capital)}
                            selection={Math.max(0, levels.indexOf(agentModels.level(agent, tool)))}
                            refused={levels.map((level) => agentModels.refusal(agent, tool.name, level))}
                            onChange={(n) => set({ tools: { ...agent.tools, [tool.name]: levels[n] } })}
                          />
                        </div>
                      </TableRow>
                    );
                  })}
                </div>
              );
            })}
            {/* Always waits on a person, whatever the levels above: shown at its one level, disabled. */}
            {agent.locked.length > 0 && (
              <div className="flex flex-col">
                <GroupTitle title="Locked" count={agent.locked.length} />
                {agent.locked.map((group) => (
                  <TableRow key={group.category} index={index++}>
                    <div className="flex w-full items-center gap-4">
                      <Item title={group.category} line={{ sub: group.tools.join(", ") }} monoSub />
                      <Enabled.Provider value={false}>
                        <Segments items={["Auto", "Approval", "Deny"]} selection={["auto", "approval", "deny"].indexOf(group.level)} />
                      </Enabled.Provider>
                    </div>
                  </TableRow>
                ))}
              </div>
            )}
          </div>
        </FormSection>
        <FormSection title="Skills" text="The agent loads one when its description matches what it was asked.">
          {skills.length === 0 ? (
            <EmptyState glyph="sparkle" text="No skills in this workspace yet." />
          ) : (
            <div className="flex flex-col items-start gap-1">
              {skills.map((s) => (
                <ToggleRow
                  key={s.id}
                  title={s.name}
                  line={s.tagline ? { sub: s.tagline } : undefined}
                  on={agent.skillIds.includes(s.id)}
                  onChange={(on) => set({ skillIds: on ? [...agent.skillIds, s.id] : agent.skillIds.filter((id) => id !== s.id) })}
                />
              ))}
            </div>
          )}
        </FormSection>
      </Enabled.Provider>
      {!isNew && !original.archived && (
        <FormFoot>
          <Button kind="tinted" size="small" glyph="archive" onClick={() => actions.archive?.(original)}>
            Archive
          </Button>
        </FormFoot>
      )}
    </RecordPage>
  );
}
