import { useState, type ReactNode } from "react";
import { Notice } from "../../conversation";
import { hasFailed, useDelayedBusy } from "../../busy";
import { CardRow, SkeletonRows, TableRow } from "../../data";
import { SearchField } from "../../heads";
import { SelectInput, TextInput } from "../../inputs";
import { Button, Choice, Field, Item, LoadingState } from "../../primitives";
import { EmptyState, ErrorState, OnboardingFrame, type BandStep, type OnboardingPoint } from "../../start";
import { codeFormat } from "../code/models";
import { onboardingSteps, repoParts, type OnboardingEnvironment, type OnboardingField, type OnboardingLoad, type OnboardingRepo, type OnboardingStep } from "./models";
import { startPromise, startHeading } from "./signin";

export type OnboardingScreenProps = {
  // The signed-in email; `signOut` is the app's sign-out, as the account menu's.
  who?: string;
  step: OnboardingStep;
  load: OnboardingLoad;
  busy?: boolean;
  refusal?: string;
  // What the API refused, by field.
  errors?: Record<string, string[]>;
  agent?: string;
  values?: Record<string, string>;
  // Another workspace's name: "Back to <leave>".
  leave?: string;
  create?: (name: string) => void;
  install?: () => void;
  // Authorize on GitHub, which finds an App installed already: GitHub's install page does not always send back.
  check?: () => void;
  // The latest journey to GitHub: waiting on it, and what came of one that did not connect (`none` or `failed`).
  journey?: { waiting: boolean; outcome?: string; message?: string };
  stop?: () => void;
  next?: () => void;
  pick?: (repo: OnboardingRepo) => void;
  save?: (environment: OnboardingEnvironment) => void;
  choose?: (agent: string | undefined, values: Record<string, string>) => void;
  start?: (prompt: string) => void;
  back?: () => void;
  // Given once a repository, its environment and an agent exist: opens the app before the first task.
  skip?: () => void;
  leaving?: () => void;
  retry?: () => void;
  signOut?: () => void;
};

const tasks: [string, string][] = [
  ["Explain how this app is organised", "Reads only"],
  ["Run the app and show me the home page", "Opens the preview"],
  ["Run the test suite and fix the first failing test", "Changes code on its branch"],
];

// The step's title while its record is read or failed to load.
const waiting: Record<OnboardingStep, string> = {
  workspace: "Name it",
  github: "GitHub",
  repository: "Choose a repository",
  environment: "Machine and setup",
  agent: "Coding agent",
  session: "What should the agent do?",
};

const fine = "You can leave and come back; nvoi keeps your place.";

const record = (load: OnboardingLoad) => (typeof load === "object" && "ready" in load ? load.ready : undefined);

// The first run, one decision per step: the workspace, GitHub, a repository, how it runs, the agent, a first task.
// The record comes from `GET onboarding`; each step sends what it decided through its action, `refusal` and
// `errors` (by API field) show what the API refused. `back` and `leave` show only when given.
export function OnboardingScreen(props: OnboardingScreenProps) {
  // Each step seeds its fields from the record once it is read.
  return <OnboardingStepForm key={`${props.step}-${!!record(props.load)}`} {...props} />;
}

// One step of onboarding, its fields seeded from the record.
function OnboardingStepForm({
  who, step, load, busy = false, refusal, errors = {}, agent: chosenAgent, values: givenValues = {}, leave, create = () => {}, install = () => {},
  check = () => {}, journey, stop = () => {}, next = () => {}, pick = () => {}, save = () => {}, choose = () => {}, start = () => {}, back, skip, leaving = () => {}, retry = () => {}, signOut = () => {},
}: OnboardingScreenProps) {
  const r = record(load);
  const loadHeld = useDelayedBusy(load === "loading", hasFailed(load));
  // The repositories are still being read from GitHub and none is known yet.
  const listing = !!r?.reading && r.repos.length === 0;
  const listingHeld = useDelayedBusy(listing);
  const number = onboardingSteps.indexOf(step) + 1;
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [repository, setRepository] = useState(r?.repo?.id ?? r?.repos[0]?.id);
  const [option, setOption] = useState(r?.environment?.option ?? r?.options.find((o) => !o.onRequest)?.label ?? "");
  const [command, setCommand] = useState(r?.environment?.start ?? "");
  const [setup, setSetup] = useState(r?.environment?.setup ?? "");
  const [agent, setAgent] = useState(chosenAgent ?? r?.agents[0]?.id);
  const [values, setValues] = useState(() => {
    const seeded = { ...givenValues };
    for (const f of r?.provider.fields ?? []) if (f.type === "select" && seeded[f.key] === undefined && f.options?.[0]) seeded[f.key] = f.options[0].value;
    return seeded;
  });
  const [task, setTask] = useState(0);
  const [prompt, setPrompt] = useState("");

  // The agent the first session runs: the one picked, else the runner's name.
  const picked = r ? (r.agents.find((a) => a.id === agent)?.name ?? (r.provider.label || undefined)) : undefined;
  const machine = r?.environment?.option;
  const answers = [r?.workspace, r?.accounts[0]?.login, r?.repo ? repoParts.short(r.repo) : undefined, machine, picked, undefined];
  const steps: BandStep[] = ["Workspace", "GitHub", "Repository", "Environment", "Agent", "First task"].map((label, i) => ({
    label,
    value: answers[i],
    state: i + 1 < number ? "done" : i + 1 === number ? "current" : "todo",
  }));

  const error = (key: string) => errors[key]?.join(", ");
  // The API's errors this step has no field for, with the refusal.
  const notice = (shown: string[]) => {
    const rest = Object.keys(errors)
      .filter((k) => !shown.includes(k))
      .sort()
      .map((k) => (k === "base" ? errors[k].join(" ") : `${k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())} ${errors[k].join(", ")}`));
    const lines = [...(refusal ? [refusal] : []), ...rest];
    return lines.length ? lines.join(" ") : undefined;
  };

  const exits = (
    <>
      {back && (
        <Button kind="ghost" onClick={back}>
          Back
        </Button>
      )}
      {skip && (
        <Button kind="ghost" onClick={skip}>
          Open the app
        </Button>
      )}
      {leave && (
        <Button kind="ghost" onClick={leaving}>
          {`Back to ${leave}`}
        </Button>
      )}
    </>
  );
  const foot = (title: string, ready: boolean, perform: () => void) => (
    <>
      {exits}
      <span className="flex-1" />
      <Button kind={ready ? "primary" : "disabled"} loading={busy} onClick={perform}>
        {title}
      </Button>
    </>
  );
  const kicker = `Step ${number} of 6`;

  if (!r || loadHeld) {
    return (
      <OnboardingFrame kicker={kicker} heading={startHeading} text={startPromise} steps={steps} title={waiting[step]} who={who} signOut={signOut} foot={foot("Continue", false, () => {})}>
        {load === "loading" || loadHeld ? <LoadingState /> : <ErrorState message={typeof load === "object" && "failed" in load ? load.failed : ""} retry={retry} />}
      </OnboardingFrame>
    );
  }

  const frame = (
    p: { heading: [string, string]; text: string; points?: OnboardingPoint[]; title: string; lede?: string; shown?: string[] },
    content: ReactNode,
    footer: ReactNode,
  ) => {
    const said = notice(p.shown ?? []);
    return (
      <OnboardingFrame
        kicker={kicker}
        heading={{ first: p.heading[0], second: p.heading[1] }}
        text={p.text}
        points={p.points}
        fine={fine}
        steps={steps}
        title={p.title}
        lede={p.lede}
        who={who}
        signOut={signOut}
        foot={footer}
      >
        {said && <Notice text={said} tone="red" />}
        {content}
      </OnboardingFrame>
    );
  };

  switch (step) {
    case "workspace": {
      const ready = name.trim() !== "";
      return frame(
        {
          heading: ["A workspace.", "Yours, from the start."],
          text: "Its own repositories, sessions, members and billing. You own it, and it starts with GitHub.",
          points: [
            { glyph: "people", title: "Invite your team", text: "Members join it with a role; agents work for all of them." },
            { glyph: "lock", title: "Separate by design", text: "Nothing crosses from one workspace to another." },
          ],
          title: "Name it",
          lede: "The name shows in the workspace menu. You can change it later.",
          shown: ["name"],
        },
        <Field label="Name" error={error("name") && `Name ${error("name")}`} className="max-w-[360px]">
          <TextInput placeholder="Northwind" value={name} onChange={setName} error={!!error("name")} onSubmit={() => ready && !busy && create(name)} />
        </Field>,
        foot("Continue", ready, () => create(name)),
      );
    }
    case "github": {
      const connected = r.accounts.length > 0;
      const outcome = journey?.message && !journey.waiting ? <Notice text={journey.message} tone={journey.outcome === "none" ? "blue" : "red"} /> : null;
      return frame(
        {
          heading: ["Connect GitHub.", "Keep the keys."],
          text: "nvoi reads your repositories and, when you allow it, pushes and opens pull requests. It does this from its own servers.",
          points: [
            { glyph: "lock", title: "Your keys stay yours", text: "Revoke access from GitHub at any time." },
            { glyph: "branch", title: "Branches, never main", text: "Agents work on their own branch and ask before they push." },
          ],
          title: connected ? "GitHub is connected" : "Install nvoi on GitHub",
          lede: connected ? "Add another account, or go on to pick a repository." : "Choose the account whose repositories agents will work on. GitHub asks which one.",
        },
        connected ? (
          <>
            {outcome}
            <div className="flex flex-col">
              {r.accounts.map((a, i) => (
                <TableRow key={a.login} index={i}>
                  <Item
                    title={a.login}
                    line={{ sub: `${a.type === "User" ? "Personal account" : "GitHub organisation"} · ${a.repositories} ${a.repositories === 1 ? "repository" : "repositories"}` }}
                    lead={{ visual: "github" }}
                   
                  />
                </TableRow>
              ))}
            </div>
            <div className="flex gap-2">
              <Button size="small" loading={journey?.waiting} onClick={install}>
                {journey?.waiting ? "Waiting for GitHub…" : "Add another account"}
              </Button>
              {journey?.waiting && (
                <Button size="small" kind="ghost" onClick={stop}>
                  Stop waiting
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
          {outcome}
          <div className="flex gap-2">
            <Button kind="primary" glyph="github" loading={journey?.waiting} onClick={install}>
              {journey?.waiting ? "Waiting for GitHub…" : "Install on GitHub"}
            </Button>
            {journey?.waiting ? (
              <Button kind="ghost" onClick={stop}>
                Stop waiting
              </Button>
            ) : (
              <Button onClick={check}>Installed already? Check GitHub</Button>
            )}
          </div>
          </>
        ),
        foot("Continue", connected, next),
      );
    }
    case "repository": {
      const q = query.toLowerCase();
      const shown = q ? r.repos.filter((repo) => repo.name.toLowerCase().includes(q)) : r.repos;
      const chosen = r.repos.find((repo) => repo.id === repository);
      return frame(
        { heading: ["One repository.", "To begin with."], text: "Pick a web application you know. On the next step you say how it runs.", title: "Choose a repository" },
        <>
          {r.reading && <Notice text="Reading your repositories from GitHub. New ones appear here in a moment." tone="blue" />}
          {(r.repos.length > 0 || query !== "") && <SearchField placeholder="Search repositories" value={query} onChange={setQuery} entries="medium" />}
          {(listing || listingHeld) && query === "" ? (
            <SkeletonRows count={3} />
          ) : shown.length > 0 ? (
            <div className="flex flex-col">
              {shown.map((repo, i) => (
                <TableRow key={repo.id} index={i} selected={repository === repo.id} action={() => setRepository(repo.id)}>
                  <Item title={repoParts.short(repo)} line={{ over: repoParts.owner(repo) }} lead={{ radio: repository === repo.id }} />
                </TableRow>
              ))}
            </div>
          ) : query !== "" ? (
            <EmptyState glyph="repo" text={`No repository’s name contains “${query}”.`} />
          ) : (
            <EmptyState glyph="repo" title="No repositories yet" text="The accounts you connected reach none. Grant nvoi a repository on GitHub, or connect another account." />
          )}
        </>,
        foot("Continue", !!chosen, () => chosen && pick(chosen)),
      );
    }
    case "environment": {
      const machineError = error("option");
      return frame(
        {
          heading: ["How it runs.", "Change it any time."],
          text: "Each checkout gets a machine built from this setup. You can change everything later in the environment.",
          title: "Machine and setup",
          lede: "Where its checkouts run, and the command that starts the app. Setup commands are optional; one that fails never holds agents back.",
          shown: ["option"],
        },
        <>
          <Field label="Machine" error={machineError && `Machine ${machineError}`}>
            <CardRow>
              {r.options.map((o) => (
                <Choice
                  key={o.label}
                  title={o.label}
                  detail={`${o.cpu} vCPU · ${o.memory} GB\n${o.onRequest ? "On request" : o.price !== undefined ? codeFormat.rate(o.price, o.currency) : ""}`}
                  selected={option === o.label}
                  disabled={o.onRequest}
                  onClick={() => setOption(o.label)}
                />
              ))}
            </CardRow>
          </Field>
          <Field label="Start command" help="Serves the preview.">
            <TextInput placeholder="bin/dev" value={command} onChange={setCommand} mono />
          </Field>
          <Field label="Setup command">
            <TextInput placeholder="bundle install" value={setup} onChange={setSetup} mono />
          </Field>
        </>,
        foot("Continue", option !== "", () => save({ option, start: command, setup })),
      );
    }
    case "agent": {
      const missing = !r.credential && r.provider.fields.some((f) => f.required && !values[f.key]);
      const label = (f: OnboardingField) => f.options?.find((o) => o.value === values[f.key])?.label ?? f.options?.[0]?.label ?? "";
      const filled = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ""));
      return frame(
        {
          heading: ["Who does the work.", "The agents you prefer."],
          text: "Coding agents run on each checkout with your credential. They never leave the machine they work on.",
          points: [
            { glyph: "lock", title: "Your credential, encrypted", text: "Stored for this workspace, never shown again." },
            { glyph: "bot", title: "More agents later", text: "Start with one; add others with their own models and skills." },
          ],
          title: "Coding agent",
          lede: "The agent and the credential it signs in with.",
        },
        <>
          <Field label="Agent">
            {r.agents.length === 0 ? (
              <Choice title={r.provider.label} detail="Anthropic’s coding agent." selected />
            ) : (
              <div className="flex flex-col gap-2">
                {r.agents.map((a) => (
                  <Choice key={a.id} title={a.name} detail={r.provider.label} selected={agent === a.id} onClick={() => setAgent(a.id)} />
                ))}
              </div>
            )}
          </Field>
          {!r.credential &&
            r.provider.fields.map((f) =>
              f.type === "select" ? (
                <Field key={f.key} label={f.label} required={f.required}>
                  <SelectInput
                    placeholder={`Choose ${f.label.toLowerCase()}`}
                    options={(f.options ?? []).map((o) => o.label)}
                    selection={label(f)}
                    onChange={(l) => setValues((v) => ({ ...v, [f.key]: f.options?.find((o) => o.label === l)?.value ?? "" }))}
                    glyph="key"
                  />
                </Field>
              ) : (
                <Field key={f.key} label={f.label} required={f.required} help={f.secret ? "Stored encrypted; it is never shown again." : undefined}>
                  <TextInput placeholder={f.placeholder ?? ""} value={values[f.key] ?? ""} onChange={(text) => setValues((v) => ({ ...v, [f.key]: text }))} mono secure={f.secret} />
                </Field>
              ),
            )}
        </>,
        foot("Continue", !missing, () => choose(agent, r.credential ? {} : filled)),
      );
    }
    case "session": {
      const text = prompt.trim();
      return frame(
        {
          heading: ["A first task.", "Then watch them work."],
          text: "nvoi builds the machine, checks out a new branch and starts the agent on it. You watch it work and see the app run.",
          title: `What should ${picked ?? "the agent"} do?`,
          shown: ["prompt"],
        },
        <>
          <div className="flex flex-col gap-2">
            {tasks.map(([title, detail], i) => (
              <Choice
                key={title}
                title={title}
                detail={detail}
                selected={text === "" && task === i}
                onClick={() => {
                  setTask(i);
                  setPrompt("");
                }}
              />
            ))}
          </div>
          <Field label="Or write your own" error={error("prompt")}>
            <TextInput placeholder="What should the agent do?" value={prompt} onChange={setPrompt} error={!!error("prompt")} rows={3} />
          </Field>
        </>,
        foot("Start the session", true, () => start(text === "" ? tasks[task][0] : text)),
      );
    }
  }
}
