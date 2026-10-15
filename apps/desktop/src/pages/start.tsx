// The first run against the hub: sign in with GitHub, then onboarding (a workspace, its boot, the agents' keys, a
// repository, the environment an agent proposes, its seed), which ends on the first session's preview.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  OnboardingScreen, paths, SignInScreen, type OnboardingEnvironment, type OnboardingKeys, type OnboardingLoad, type OnboardingLog, type OnboardingRepo, type OnboardingStep,
  type OnboardingWorkspace,
} from "@h0/ui";
import { sse, StreamError } from "@h0/transport";
import * as native from "@/native";
import { bearer, get, hub, hubRequest, openUrl, request, spaceRequest, workspace } from "../api/client";
import { useAccount, useApi, useHub, useUpdates } from "../api/live";
import type { Environment, LlmConfig, Offer, Repositories, RunEvent, Seed, Session, Update, Workspace } from "../api/models";
import { message, sessionTitle } from "../api/session";
import { signInWithGithub } from "../api/start";
import { store } from "../store";

// The window has no title bar: the top of a first-run page drags it.
function Window({ children }: { children: ReactNode }) {
  return (
    <div className="relative h-full">
      <div data-drag className="absolute inset-x-0 top-0 z-10 h-11" />
      {children}
    </div>
  );
}

export function SignInPage() {
  const { adopt } = useAccount();
  const [error, setError] = useState<string>();
  const [waiting, setWaiting] = useState(false);
  // Leaving the page, or Stop, stops waiting for GitHub.
  const [left] = useState({ now: false });
  useEffect(() => {
    left.now = false;
    return () => void (left.now = true);
  }, []);
  const github = async () => {
    left.now = false;
    setWaiting(true);
    setError(undefined);
    try {
      await adopt(await signInWithGithub(() => left.now));
    } catch (e) {
      if (!left.now) setError(message(e));
    }
    setWaiting(false);
  };
  return (
    <Window>
      <SignInScreen error={error} waiting={waiting} github={() => void github()} stop={() => void (left.now = true)} />
    </Window>
  );
}

// A workspace not set up yet, or a new one (`create`).
export function OnboardingPage({ create = false }: { create?: boolean }) {
  const { me } = useAccount();
  return <Onboarding key={`${create}-${me?.workspace?.name}`} create={create} />;
}

// How long the plane of a workspace whose run ended may take to answer, asked every two seconds.
const ANSWER_TRIES = 30;

// The provisioning run's lines from the hub, resumed from the last line after a drop; four failed opens in a row end it.
function useRun(ws: string | undefined, run: string | undefined, done: () => Promise<void>): OnboardingLog | undefined {
  const [log, setLog] = useState<OnboardingLog>();
  useEffect(() => {
    if (!ws || !run) return;
    const stop = new AbortController();
    const lines: string[] = [];
    let from = 0;
    let tries = 0;
    setLog({ lines: [], state: "running" });
    (async () => {
      while (!stop.signal.aborted) {
        try {
          const url = `${hub}/v1/workspaces/${encodeURIComponent(ws)}/runs/${encodeURIComponent(run)}/stream?from=${from}`;
          for await (const m of sse(native.fetch, url, bearer(), undefined, stop.signal)) {
            tries = 0;
            if (!m.data) continue;
            const e = JSON.parse(m.data) as RunEvent;
            if (m.id) from = Number(m.id) + 1;
            if (e.state === "failed") return setLog({ lines: [...lines], state: "failed", failed: e.line });
            if (e.line) lines.push(e.line);
            if (e.state === "ok") {
              setLog({ lines: [...lines], state: "ok" });
              return await done();
            }
            setLog({ lines: [...lines], state: "running" });
          }
        } catch (e) {
          if (stop.signal.aborted) return;
          if (++tries >= 4) return setLog({ lines: [...lines], state: "failed", failed: e instanceof StreamError ? `The run's log answered ${e.status}.` : message(e) });
        }
        await new Promise((wake) => setTimeout(wake, 2000));
      }
    })();
    return () => stop.abort();
  }, [ws, run]);
  return log;
}

// The proposal as the step edits it: the first service serves the preview.
const editable = (e: Environment): OnboardingEnvironment => ({
  name: e.name,
  tier: e.tier ?? "",
  start: e.services?.[0]?.command ?? "",
  port: e.preview || e.services?.[0]?.port || 3000,
  setup: (e.setup ?? []).join("\n"),
});

function edited(e: Environment, o: OnboardingEnvironment): Environment {
  const [first, ...rest] = e.services ?? [];
  return {
    ...e,
    name: o.name.trim(),
    tier: o.tier || undefined,
    preview: o.port,
    setup: o.setup.split("\n").map((l) => l.trim()).filter(Boolean),
    services: [{ ...(first ?? { name: "web" }), command: o.start.trim(), port: o.port }, ...rest],
  };
}

function Onboarding({ create }: { create: boolean }) {
  const { me, refresh, logout, switchTo, enter } = useAccount();
  const current: Workspace | undefined = create ? undefined : me?.workspace;
  const ready = !!current?.ready;
  const [chosen, setChosen] = useState<OnboardingStep>();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string>();
  const [proposal, setProposal] = useState<Environment>();
  const [seeding, setSeeding] = useState<string>();
  const [run, setRun] = useState<string>();

  const configs = useApi<LlmConfig[]>(ready ? "llm/configs" : undefined);
  const named: OnboardingStep = !current ? "workspace" : !ready ? "boot" : configs.data && configs.data.length === 0 ? "agent" : "repository";
  const step: OnboardingStep = chosen ?? named;

  const offer = useHub<Offer>(step === "workspace" ? "offer" : undefined);
  const listed = useHubSpace<Repositories>(step === "repository" ? "repositories" : undefined);
  const shape = useApi<{ tiers: { name: string; cpu: string; memory: string; default?: boolean }[] }>(step === "environment" ? "cluster/shape" : undefined);

  // The run ended: the plane answers, then the agents' keys.
  const answered = useCallback(async () => {
    let last: unknown;
    for (let i = 0; i < ANSWER_TRIES; i++) {
      try {
        await get("me");
        await refresh();
        return setChosen(undefined);
      } catch (e) {
        last = e;
        await new Promise((wake) => setTimeout(wake, 2000));
      }
    }
    setRefusal(`The workspace's plane did not answer: ${message(last)}`);
  }, [refresh]);
  const boot = useRun(step === "boot" ? current?.name : undefined, run ?? current?.run ?? undefined, answered);
  const seed = useSeed(step === "seed" ? seeding : undefined, async (env) => {
    const session = await request<Session>("POST", "sessions", { env, prompt: "" });
    enter();
    store.navigate(`${paths.session(session.id)}/preview`, "tab", sessionTitle(session));
  });

  const records: Partial<Record<OnboardingStep, OnboardingLoad>> = {
    workspace: offer.data
      ? { ready: { offer: { credit: offer.data.credit_cents, currency: offer.data.currency, plans: offer.data.plans.map((p) => ({ name: p.name, label: p.label, cpu: p.cpu, memory: p.memory, price: p.hourly_cents })), locations: offer.data.locations } } }
      : offer.error
        ? { failed: message(offer.error) }
        : "loading",
    boot: { ready: { log: boot } },
    agent: { ready: {} },
    repository: listed.data
      ? { ready: { repos: listed.data.repositories.map((r) => ({ id: r.full_name, name: r.full_name })), install: listed.data.install_url } }
      : listed.error
        ? { failed: message(listed.error) }
        : "loading",
    environment: proposal && shape.data ? { ready: { tiers: shape.data.tiers, environment: editable(proposal) } } : shape.error ? { failed: message(shape.error) } : "loading",
    seed: { ready: { log: seed } },
  };
  const load: OnboardingLoad = records[step] ?? "loading";

  function move(to: OnboardingStep) {
    setRefusal(undefined);
    setChosen(to);
  }

  async function act(perform: () => Promise<void>) {
    setBusy(true);
    setRefusal(undefined);
    try {
      await perform();
    } catch (e) {
      setRefusal(message(e));
    }
    setBusy(false);
  }

  // Another workspace to go back to, the alphabetically first.
  const other = me?.workspaces.filter((w) => w.name !== workspace() && w.ready).sort((a, b) => a.name.localeCompare(b.name))[0];

  const back: (() => void) | undefined = {
    workspace: create ? () => store.overlay(undefined) : undefined,
    boot: undefined,
    agent: undefined,
    repository: () => move("agent"),
    environment: () => move("repository"),
    seed: undefined,
  }[step];

  const keys = (k: OnboardingKeys) =>
    act(async () => {
      if (k.anthropic) {
        const kind = k.anthropic.startsWith("sk-ant-oat") ? "oauth" : "api_key";
        await request("POST", "llm/configs", { name: "Claude", provider: "claude_code", values: { kind, token: k.anthropic } });
      }
      if (k.openai) await request("POST", "llm/configs", { name: "OpenAI", provider: "codex", values: { kind: "api_key", token: k.openai } });
      move("repository");
    });

  return (
    <Window>
      <OnboardingScreen
        who={me?.user.login}
        step={step}
        load={load}
        busy={busy}
        refusal={refusal}
        leave={create ? undefined : other?.name}
        leaving={() => other && void act(() => switchTo(other.name))}
        create={(w: OnboardingWorkspace) =>
          void act(async () => {
            const made = await hubRequest<Workspace>("POST", "workspaces", w);
            store.overlay(undefined);
            await switchTo(made.name);
          })
        }
        again={() =>
          void act(async () => {
            if (step === "boot") setRun((await spaceRequest<{ id: string }>("POST", "runs")).id);
            else if (seeding) await request("POST", `environments/${encodeURIComponent(seeding)}/seed`);
          })
        }
        keys={(k) => void keys(k)}
        skip={() => move("repository")}
        install={() => listed.data && void openUrl(listed.data.install_url)}
        check={() => void listed.refetch()}
        pick={(repo: OnboardingRepo) =>
          void act(async () => {
            setProposal(await request<Environment>("POST", "environments/propose", { repo: repo.name }));
            move("environment");
          })
        }
        save={(o: OnboardingEnvironment) =>
          void act(async () => {
            if (!proposal) return;
            const env = edited(proposal, o);
            await request("PUT", `environments/${encodeURIComponent(env.name)}`, env);
            await request("POST", `environments/${encodeURIComponent(env.name)}/seed`);
            setSeeding(env.name);
            move("seed");
          })
        }
        back={back}
        retry={() => [offer, listed, shape].forEach((q) => void q.refetch())}
        signOut={() => {
          store.overlay(undefined);
          void logout();
        }}
      />
    </Window>
  );
}

// A GET on the hub under the workspace in use (`/v1/workspaces/{ws}/<path>`).
function useHubSpace<T>(path: string | undefined) {
  return useHub<T>(path ? `workspaces/${encodeURIComponent(workspace() ?? "")}/${path}` : undefined);
}

// The seed's build as the plane's stream tells it: a line with each beat that moved, its end. A ready seed calls
// `ready` once.
function useSeed(env: string | undefined, ready: (env: string) => Promise<void>): OnboardingLog | undefined {
  const [log, setLog] = useState<OnboardingLog>();
  const lines = useRef<string[]>([]);
  const seen = useRef(-1);
  const opened = useRef(false);
  const take = useCallback(
    (s: Seed) => {
      if (!env || s.env !== env) return;
      if (s.line && s.lines !== seen.current) {
        seen.current = s.lines ?? seen.current + 1;
        lines.current = [...lines.current, s.line];
      } else if (s.step && lines.current[lines.current.length - 1] !== s.step && !s.line) {
        lines.current = [...lines.current, s.step];
      }
      if (s.state === "failed") return setLog({ lines: lines.current, state: "failed", failed: s.error ?? "The build failed." });
      if (s.state === "ready") {
        setLog({ lines: lines.current, state: "ok" });
        if (!opened.current) {
          opened.current = true;
          void ready(env).catch((e) => setLog({ lines: lines.current, state: "failed", failed: `The first session did not start: ${message(e)}` }));
        }
        return;
      }
      setLog({ lines: lines.current, state: "running" });
    },
    [env, ready],
  );
  useEffect(() => {
    if (!env) return;
    lines.current = [];
    seen.current = -1;
    opened.current = false;
    setLog({ lines: [], state: "running" });
    get<Seed>(`environments/${encodeURIComponent(env)}/seed`).then(take, () => undefined);
  }, [env]);
  useUpdates(useCallback((u: Update) => u.kind === "seed" && take(u.seed), [take]));
  return log;
}

