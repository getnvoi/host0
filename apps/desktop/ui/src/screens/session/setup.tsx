import { useEffect, useRef, useState, type ReactNode } from "react";
import { ComposerBox, type ComposerBadges, type ComposerChoice } from "../../composer";
import { Notice } from "../../conversation";
import { Floating, Frame } from "./floating";
import { menu, MenuPanel, type MenuEntry } from "../../menu";
import { Button } from "../../primitives";
import { Surface } from "../../surface";
import { EmptyState } from "../../start";
import { useNavigate } from "../navigate";
import { paths, type SettingsPage } from "../routes";
import { useDictation, type Dictate } from "./dictation";
import { project, type AgentRecord } from "./records";

// An environment a session can start on, and the repositories its machines may host (owner/name), in order; a session
// names those it works on among them, none or several.
export type EnvironmentChoice = { id: string; name: string; repositories: string[] };

// What a session starts with: its agent and environment (ids), the repositories it works on among those the
// environment hosts (owner/name), none for a sandbox with no checkout. An empty agent or environment: there is none.
export type SetupRecord = { agent: string; environment: string; repositories: string[] };

// The new session dialog's steps, in order: the agent, the environment, the repositories it hosts, the message.
export type SetupStep = ComposerChoice | "message";
export const setupSteps: SetupStep[] = ["agent", "environment", "repositories", "message"];

// What each step asks, under the dialog's title, and its glyph.
const asked: Record<SetupStep, [string, string]> = {
  agent: ["Choose the agent that runs it.", "bot"],
  environment: ["Choose the environment it runs in.", "terminal"],
  repositories: ["Each one picked is checked out in the working folder, on a new branch.", "repo"],
  message: ["A fresh machine, a new branch of each repository picked.", "session"],
};

export const setup = {
  // The setup a dialog opens on: the last one, each part while it is still there, else the first agent, no environment
  // (the person picks it) and no repository. `named`: the repositories a New session is started on (a repository's),
  // in an environment that hosts them all.
  first(agents: AgentRecord[], environments: EnvironmentChoice[], last?: SetupRecord, named: string[] = []): SetupRecord {
    const hosting = environments.filter((e) => named.every((r) => e.repositories.includes(r)));
    const environment = hosting.find((e) => e.id === last?.environment);
    const kept = last && last.environment === environment?.id ? last.repositories : [];
    return {
      agent: (agents.find((a) => a.id === last?.agent) ?? agents[0])?.id ?? "",
      environment: environment?.id ?? "",
      repositories: [...named, ...kept].filter((r, i, all) => all.indexOf(r) === i && environment?.repositories.includes(r)),
    };
  },
  // Another environment: the repositories it does not host are dropped.
  on: (s: SetupRecord, e: EnvironmentChoice): SetupRecord => ({ ...s, environment: e.id, repositories: s.repositories.filter((r) => e.repositories.includes(r)) }),
  // The composer's badges for it: the agent and its model, the environment, the repositories without their owner.
  badges(s: SetupRecord, agents: AgentRecord[], environments: EnvironmentChoice[]): ComposerBadges {
    const agent = agents.find((a) => a.id === s.agent);
    return {
      agent: agent?.name ?? "No agent",
      model: agent?.model ?? undefined,
      environment: environments.find((e) => e.id === s.environment)?.name,
      repos: s.repositories.map((r) => project({ name: r })),
    };
  },
  // Why nothing can be started, as `new_session_blocker` says it.
  blocker: (agents: AgentRecord[], environments: EnvironmentChoice[]) =>
    !environments.length
      ? "This workspace has no environment yet. Add one to start a session in it."
      : !agents.length
        ? "This workspace has no agent yet. Create one to start a session."
        : undefined,
};

export type NewSessionDialogProps = {
  agents?: AgentRecord[];
  environments?: EnvironmentChoice[];
  setup?: SetupRecord;
  // The step it opens on. The first of `steps` walks them in order to the message (a workspace's first session);
  // another is a shortcut, which goes back where it came from once chosen: the message, or out of the dialog when it
  // has none.
  at?: SetupStep;
  // Home has its own composer: its dialog stops before the message.
  steps?: SetupStep[];
  // Each choice, as it is made.
  change?: (setup: SetupRecord) => void;
  prompt?: string;
  starting?: boolean;
  error?: string;
  start?: (setup: SetupRecord, prompt: string) => void;
  // The app's recognizer, for the composer's mic.
  dictate?: Dictate;
  close?: () => void;
};

// Starting a session (`POST /sessions`): the agent, the environment, the repositories among those it hosts, then the
// first message, in the composer whose badges come back to each choice.
export function NewSessionDialog({
  agents = [], environments = [], setup: given, at = "message", steps = setupSteps, change = () => {},
  prompt: initialPrompt = "", starting = false, error, start = () => {}, dictate, close = () => {},
}: NewSessionDialogProps) {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(() => given ?? setup.first(agents, environments));
  const [step, setStep] = useState(at);
  // Walking the steps in order, toward the message, or on a shortcut. Without a message (Home) every step is one.
  const [walking, setWalking] = useState(at === steps[0] && at !== "message" && steps.includes("message"));
  const [prompt, setPrompt] = useState(initialPrompt);
  const dictation = useDictation(dictate, prompt, setPrompt);
  const environment = environments.find((e) => e.id === current.environment);
  const blocker = setup.blocker(agents, environments);
  const ready = !blocker && prompt.trim().length > 0;
  const submit = () => {
    if (!ready || starting) return;
    dictation.settle();
    start(current, prompt);
  };
  const latest = useRef(submit);
  latest.current = submit;
  useEffect(() => {
    if (step !== "message") return;
    const listen = (e: KeyboardEvent) => {
      if (e.key === "Enter" && e.metaKey) {
        e.preventDefault();
        latest.current();
      }
    };
    addEventListener("keydown", listen);
    return () => removeEventListener("keydown", listen);
  }, [step]);

  const message = steps.filter((s) => s === "message");
  // Where a choice leads: the next step while walking; on a shortcut, a new environment's repositories, else back.
  const choose = (from: SetupStep, s: SetupRecord) => {
    setCurrent(s);
    change(s);
    const moved = from === "environment" && s.environment !== current.environment;
    const next = walking ? steps[steps.indexOf(from) + 1] : moved ? steps.find((x) => x === "repositories") : message[0];
    if (!next) return close();
    if (next === "message") setWalking(false);
    setStep(next);
  };
  const back = walking ? steps[steps.indexOf(step) - 1] : message.find((m) => m !== step);
  const jump = (to: ComposerChoice) => {
    setWalking(false);
    setStep(to);
  };
  // The settings page where what is missing is made; the dialog gives way to it.
  const manage = (page: SettingsPage) => () => {
    close();
    navigate(paths.settings(page), "tab");
  };
  const hosted = environment?.repositories ?? [];

  // Each choice's rows, or, with nothing to choose, what is missing and the way to it.
  const choices: Record<ComposerChoice, [unknown[], ReactNode]> = {
    agent: [
      agents,
      agents.length ? (
        <MenuPanel
          flush
          entries={agents.map((a) => menu.item(a.name, { radio: true, checked: a.id === current.agent, detail: a.tagline ?? a.model ?? undefined, action: () => choose("agent", { ...current, agent: a.id }) }))}
        />
      ) : (
        <EmptyState size="small" glyph="bot" title="No agent yet" text="An agent runs the session: its model, its instructions, the tools it may use." action={<Button size="mini" glyph="bot" onClick={manage("agents")}>Create an agent</Button>} />
      ),
    ],
    environment: [
      environments,
      environments.length ? (
        <MenuPanel
          flush
          entries={environments.map((e) =>
            menu.item(e.name, { radio: true, checked: e.id === current.environment, detail: e.repositories.join(", ") || "No repository", action: () => choose("environment", setup.on(current, e)) }),
          )}
        />
      ) : (
        <EmptyState size="small" glyph="terminal" title="No environment yet" text="An environment is where sessions run: its machines and the repositories they host." action={<Button size="mini" glyph="terminal" onClick={manage("environments")}>Add an environment</Button>} />
      ),
    ],
    repositories: [
      hosted,
      hosted.length ? (
        <MenuPanel
          flush
          entries={hosted.map((r): MenuEntry => {
            const on = current.repositories.includes(r);
            // Kept in the environment's order.
            const repositories = hosted.filter((x) => (x === r ? !on : current.repositories.includes(x)));
            return menu.item(r, { glyph: "repo", checked: on, action: () => setCurrent({ ...current, repositories }) });
          })}
        />
      ) : (
        <EmptyState
          size="small"
          glyph="repo"
          title={`${environment?.name ?? "This environment"} hosts no repository`}
          text="The session starts with no checkout. An environment's repositories are set in its settings."
          action={
            <Button size="mini" glyph="repo" onClick={manage("environments")}>
              Manage environments
            </Button>
          }
        />
      ),
    ],
  };

  const foot = (
    <>
      <span className="mr-auto flex items-center gap-2">
        {back && (
          <Button size="small" glyph="back" onClick={() => setStep(back)}>
            Back
          </Button>
        )}
      </span>
      {step === "repositories" ? (
        <>
          <Button size="small" onClick={() => choose("repositories", { ...current, repositories: [] })}>
            Skip
          </Button>
          <Button kind={current.repositories.length ? "primary" : "disabled"} size="small" onClick={() => choose("repositories", current)}>
            Continue
          </Button>
        </>
      ) : (
        <Button size="small" onClick={close}>
          Cancel
        </Button>
      )}
    </>
  );

  // One overlay for every step: the scrim and the frame stay while the step changes, only what is in the frame swaps.
  // The message: the composer is the dialog, its title and close inside it, its send the dialog's action (⌘↵ too).
  return (
    <Floating label="New session" close={close}>
      {step === "message" ? (
        <>
          {blocker && <Notice text={blocker} tone="orange" />}
          {error && <Notice text={error} tone="red" />}
          {dictation.refused && <Notice title="Dictation is not available" text={dictation.refused} tone="red" action="Retry" perform={dictation.toggle} />}
        </>
      ) : null}
      <Frame step={step}>
          {step === "message" ? (
            <ComposerBox
              // The other steps' header, so a step swaps under it.
              head={<Surface preset="dialog" title="New session" line={{ sub: asked.message[0] }} lead={{ visual: asked.message[1] }} close={close} />}
              mode="message"
              draft={prompt}
              onDraftChange={setPrompt}
              badges={setup.badges(current, agents, environments)}
              choose={jump}
              placeholder="What should the agent do?"
              status={starting ? ["Starting", "blue"] : undefined}
              send={submit}
              dictate={dictation.toggle}
              listening={dictation.listening}
              focus
            />
          ) : (
            <Surface
              preset="dialog"
              title="New session"
              line={{ sub: asked[step][0] }}
              lead={{ visual: asked[step][1] }}
              close={close}
              // A choice's rows run edge to edge; an empty step sits in the dialog's padding.
              inset={choices[step][0].length ? "rows" : "padded"}
              footer={foot}
            >
              {choices[step][1]}
            </Surface>
          )}
      </Frame>
    </Floating>
  );
}


