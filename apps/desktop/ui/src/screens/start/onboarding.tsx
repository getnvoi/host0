import { useState, type ReactNode } from "react";
import { Notice, TerminalBlock } from "../../conversation";
import { hasFailed, useDelayedBusy } from "../../busy";
import { CardRow, SkeletonRows, TableRow } from "../../data";
import { SearchField } from "../../heads";
import { SelectInput, TextInput } from "../../inputs";
import { Button, Choice, Field, Item, LoadingState } from "../../primitives";
import { EmptyState, ErrorState, OnboardingFrame, type OnboardingPoint } from "../../start";
import { codeFormat } from "../code/models";
import { settingsFormat } from "../settings/models";
import { repoParts, type OnboardingEnvironment, type OnboardingKeys, type OnboardingLog, type OnboardingOffer, type OnboardingRepo, type OnboardingStep, type OnboardingTier, type OnboardingWorkspace } from "./models";
import { startPromise, startHeading } from "./signin";

// What a step reads before it shows: the offer, a log, the repositories, the tiers and the proposed environment.
export type OnboardingRecord = {
  offer?: OnboardingOffer;
  log?: OnboardingLog;
  repos?: OnboardingRepo[];
  // GitHub's page to install the App, which grants it repositories.
  install?: string;
  tiers?: OnboardingTier[];
  environment?: OnboardingEnvironment;
};

// The onboarding screen's state: reading the record, the error it failed with, or the record.
export type OnboardingLoad = "loading" | { failed: string } | { ready: OnboardingRecord };

export type OnboardingScreenProps = {
  // The signed-in login; `signOut` is the app's sign-out, as the account menu's.
  who?: string;
  step: OnboardingStep;
  load: OnboardingLoad;
  busy?: boolean;
  refusal?: string;
  // Another workspace's name: "Back to <leave>".
  leave?: string;
  create?: (workspace: OnboardingWorkspace) => void;
  // Runs the failed log again: the provisioning run, or the seed's build.
  again?: () => void;
  keys?: (keys: OnboardingKeys) => void;
  skip?: () => void;
  install?: () => void;
  check?: () => void;
  pick?: (repo: OnboardingRepo) => void;
  save?: (environment: OnboardingEnvironment) => void;
  back?: () => void;
  leaving?: () => void;
  retry?: () => void;
  signOut?: () => void;
};

// The step's title while its record is read or failed to load.
const waiting: Record<OnboardingStep, string> = {
  workspace: "Name it",
  boot: "Making your workspace",
  agent: "Bring your agents",
  repository: "Choose a repository",
  environment: "Machine and setup",
  seed: "Building the environment",
};

const fine = "You can leave and come back; h0 keeps your place.";

const record = (load: OnboardingLoad) => (typeof load === "object" && "ready" in load ? load.ready : undefined);

// The first run, one decision per screen: the workspace, its boot, the agents' keys, a repository, how it runs, its
// seed. Each step sends what it decided through its action; `refusal` shows what was refused. No step counts the
// others: each page stands on its own.
export function OnboardingScreen(props: OnboardingScreenProps) {
  // Each step seeds its fields from the record once it is read.
  return <OnboardingStepForm key={`${props.step}-${!!record(props.load)}`} {...props} />;
}

function OnboardingStepForm({
  who, step, load, busy = false, refusal, leave, create = () => {}, again = () => {}, keys = () => {}, skip, install = () => {}, check = () => {}, pick = () => {},
  save = () => {}, back, leaving = () => {}, retry = () => {}, signOut = () => {},
}: OnboardingScreenProps) {
  const r = record(load);
  const loadHeld = useDelayedBusy(load === "loading", hasFailed(load));
  const [name, setName] = useState("");
  const [plan, setPlan] = useState(r?.offer?.plans[0]?.name ?? "");
  const [location, setLocation] = useState(r?.offer?.locations[0]?.label ?? "");
  const [anthropic, setAnthropic] = useState("");
  const [openai, setOpenai] = useState("");
  const [query, setQuery] = useState("");
  const [repository, setRepository] = useState(r?.repos?.[0]?.id);
  const [env, setEnv] = useState<OnboardingEnvironment>(r?.environment ?? { name: "", tier: "", start: "", port: 3000, setup: "" });

  const exits = (
    <>
      {back && (
        <Button kind="ghost" onClick={back}>
          Back
        </Button>
      )}
      {leave && (
        <Button kind="ghost" onClick={leaving}>
          {`Back to ${leave}`}
        </Button>
      )}
    </>
  );
  const foot = (title: string, ready: boolean, perform: () => void, more?: ReactNode) => (
    <>
      {exits}
      <span className="flex-1" />
      {more}
      <Button kind={ready ? "primary" : "disabled"} loading={busy} onClick={perform}>
        {title}
      </Button>
    </>
  );

  if (!r || loadHeld) {
    return (
      <OnboardingFrame heading={startHeading} text={startPromise} title={waiting[step]} who={who} signOut={signOut} foot={foot("Continue", false, () => {})}>
        {load === "loading" || loadHeld ? <LoadingState /> : <ErrorState message={typeof load === "object" && "failed" in load ? load.failed : ""} retry={retry} />}
      </OnboardingFrame>
    );
  }

  const frame = (p: { heading: [string, string]; text: string; points?: OnboardingPoint[]; title: string; lede?: string }, content: ReactNode, footer: ReactNode) => (
    <OnboardingFrame heading={{ first: p.heading[0], second: p.heading[1] }} text={p.text} points={p.points} fine={fine} title={p.title} lede={p.lede} who={who} signOut={signOut} foot={footer}>
      {refusal && <Notice text={refusal} tone="red" />}
      {content}
    </OnboardingFrame>
  );

  // A log as it streams, and the failed step's own line once it failed.
  const logView = (log: OnboardingLog | undefined) => (
    <>
      {log?.state === "failed" && <Notice text={log.failed ?? "The run failed."} tone="red" />}
      {log && log.lines.length > 0 ? <TerminalBlock lines={log.lines.map((text) => ({ text }))} /> : <LoadingState text="Starting" />}
    </>
  );

  switch (step) {
    case "workspace": {
      const offer = r.offer;
      const chosen = offer?.plans.find((p) => p.name === plan);
      const where = offer?.locations.find((l) => l.label === location);
      const ready = /^[a-z0-9][a-z0-9-]*$/.test(name.trim()) && !!chosen && !!where;
      return frame(
        {
          heading: ["A workspace.", "Yours, from the start."],
          text: "A cluster of its own: the app it runs, the sessions forked from it, the agents' keys. You own it.",
          points: offer ? [{ glyph: "card", title: `${settingsFormat.money(offer.credit, offer.currency)} of credit to start`, text: "Machines are billed by the hour from it." }] : [],
          title: "Name it",
          lede: "Lowercase letters, digits and dashes: it names the workspace's machines and addresses.",
        },
        <>
          <Field label="Name" className="max-w-[360px]">
            <TextInput placeholder="northwind" value={name} onChange={setName} onSubmit={() => ready && !busy && create({ name: name.trim(), plan, location: where!.name })} />
          </Field>
          <Field label="Plan">
            <CardRow>
              {(offer?.plans ?? []).map((p) => (
                <Choice
                  key={p.name}
                  title={p.label}
                  detail={`${p.cpu} vCPU · ${p.memory} GB\n${codeFormat.rate(p.price, offer!.currency)}`}
                  selected={plan === p.name}
                  onClick={() => setPlan(p.name)}
                />
              ))}
            </CardRow>
          </Field>
          <Field label="Location" className="max-w-[360px]">
            <SelectInput placeholder="Choose a location" options={(offer?.locations ?? []).map((l) => l.label)} selection={location} onChange={setLocation} glyph="globe" />
          </Field>
        </>,
        foot("Create workspace", ready, () => create({ name: name.trim(), plan, location: where!.name })),
      );
    }
    case "boot": {
      const failed = r.log?.state === "failed";
      return frame(
        {
          heading: ["Its own machines.", "Started for you."],
          text: "The workspace's servers come up, the cluster joins them and its control plane starts. It takes a few minutes.",
          title: failed ? "The workspace was not made" : "Making your workspace",
          lede: failed ? "The step that failed says why. Trying again picks up where it stopped." : "You can leave; it goes on without the app.",
        },
        logView(r.log),
        failed ? foot("Try again", true, again) : foot("Continue", false, () => {}),
      );
    }
    case "agent": {
      const given = anthropic.trim() !== "" || openai.trim() !== "";
      return frame(
        {
          heading: ["Who does the work.", "The agents you prefer."],
          text: "Claude Code and Codex run on each fork with your key. The key stays in the workspace, sealed.",
          points: [
            { glyph: "lock", title: "Your key, sealed", text: "Stored for this workspace, never shown again." },
            { glyph: "key", title: "Change it later", text: "Model credentials holds every key, and which one sessions use." },
          ],
          title: "Bring your agents",
          lede: "Either key is enough. Skip this and add one later from Model credentials.",
        },
        <>
          <Field label="Anthropic API key" help="A Claude setup-token (sk-ant-oat…) works here too.">
            <TextInput placeholder="sk-ant-…" value={anthropic} onChange={setAnthropic} mono secure />
          </Field>
          <Field label="OpenAI API key">
            <TextInput placeholder="sk-…" value={openai} onChange={setOpenai} mono secure />
          </Field>
        </>,
        foot("Continue", given, () => keys({ anthropic: anthropic.trim(), openai: openai.trim() }), skip && (
          <Button kind="ghost" onClick={skip}>
            Skip
          </Button>
        )),
      );
    }
    case "repository": {
      const repos = r.repos ?? [];
      const q = query.toLowerCase();
      const shown = q ? repos.filter((repo) => repo.name.toLowerCase().includes(q)) : repos;
      const chosen = repos.find((repo) => repo.id === repository);
      return frame(
        { heading: ["One repository.", "To begin with."], text: "Pick a web application you know. An agent reads it and proposes how it runs.", title: "Choose a repository" },
        <>
          {(repos.length > 0 || query !== "") && <SearchField placeholder="Search repositories" value={query} onChange={setQuery} entries="medium" />}
          {shown.length > 0 ? (
            <div className="flex flex-col">
              {shown.map((repo, i) => (
                <TableRow key={repo.id} index={i} selected={repository === repo.id} action={() => setRepository(repo.id)}>
                  <Item title={repoParts.short(repo)} line={{ over: repoParts.owner(repo) }} lead={{ radio: repository === repo.id }} />
                </TableRow>
              ))}
            </div>
          ) : query !== "" ? (
            <EmptyState glyph="repo" text={`No repository’s name contains “${query}”.`} />
          ) : repos.length === 0 && r.repos === undefined ? (
            <SkeletonRows count={3} />
          ) : (
            <EmptyState
              glyph="repo"
              title="No repositories yet"
              text="Install the GitHub App on the account that holds your repository, and grant it the repository."
              action={
                <div className="flex gap-2">
                  <Button kind="primary" glyph="github" onClick={install}>
                    Install on GitHub
                  </Button>
                  <Button onClick={check}>Check again</Button>
                </div>
              }
            />
          )}
        </>,
        foot("Continue", !!chosen, () => chosen && pick(chosen)),
      );
    }
    case "environment": {
      const tiers = r.tiers ?? [];
      const ready = env.name.trim() !== "" && env.start.trim() !== "" && env.port > 0;
      return frame(
        {
          heading: ["How it runs.", "Change it any time."],
          text: "An agent read the repository and proposed this. Each fork of the app is built from it.",
          title: "Machine and setup",
          lede: "The command that serves the preview and its port; setup commands run once, before it starts.",
        },
        <>
          <Field label="Name" className="max-w-[360px]">
            <TextInput placeholder="web" value={env.name} onChange={(name) => setEnv({ ...env, name })} />
          </Field>
          <Field label="Machine">
            <CardRow>
              {tiers.map((t) => (
                <Choice key={t.name} title={t.name} detail={`${t.cpu} vCPU · ${t.memory}`} selected={env.tier === t.name} onClick={() => setEnv({ ...env, tier: t.name })} />
              ))}
            </CardRow>
          </Field>
          <Field label="Start command" help="Serves the preview.">
            <TextInput placeholder="bin/dev" value={env.start} onChange={(start) => setEnv({ ...env, start })} mono />
          </Field>
          <Field label="Port" className="max-w-[160px]">
            <TextInput placeholder="3000" value={String(env.port || "")} onChange={(port) => setEnv({ ...env, port: Number(port.replace(/\D/g, "")) || 0 })} mono />
          </Field>
          <Field label="Setup commands" help="One per line.">
            <TextInput placeholder="bundle install" value={env.setup} onChange={(setup) => setEnv({ ...env, setup })} mono rows={3} />
          </Field>
        </>,
        foot("Build it", ready, () => save(env)),
      );
    }
    case "seed": {
      const failed = r.log?.state === "failed";
      return frame(
        {
          heading: ["The app, running.", "Then forked for each task."],
          text: "The seed checks out the repository, runs its setup and starts the app. Every session forks it.",
          title: failed ? "The build failed" : "Building the environment",
          lede: failed ? "Its last lines say why. Change the setup, or build it again." : "The first session opens on its preview once the app answers.",
        },
        logView(r.log),
        failed ? foot("Build again", true, again) : foot("Continue", false, () => {}),
      );
    }
  }
}
