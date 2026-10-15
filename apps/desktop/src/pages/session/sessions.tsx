// The sessions list, or the board, on the plane. A row swaps the tab for its session; a session started here opens
// in a tab of its own.
import { useState } from "react";
import { load, NewSessionDialog, paths, SessionsScreen, setup, type Load, type SessionRecord, type SetupRecord } from "@h0/ui";
import { workspace } from "../../api/client";
import { stale, useApi, useWrite } from "../../api/live";
import type { EnvironmentSummary, LlmConfig, Provider, Session, Summary } from "../../api/models";
import { agentsOf, choicesOf, message, reposOf, sessionOf, sessions as api } from "../../api/session";
import { lastSetup, started } from "../../remembered";
import { listen } from "./dictation";
import { store } from "../../store";

// What the dialog and the lists read app-wide: the environments (as repositories and as choices) and the agents.
export function useStarting() {
  const environments = useApi<EnvironmentSummary[]>("environments").data ?? [];
  const configs = useApi<LlmConfig[]>("llm/configs").data ?? [];
  const providers = useApi<Provider[]>("llm/providers").data ?? [];
  const agents = agentsOf(configs, providers);
  return { environments, repos: reposOf(environments), choices: choicesOf(environments), agents, ready: environments.length + agents.length };
}

// Starts a session on its setup; answers it.
function useStart() {
  const write = useWrite((work: () => Promise<Session>) => work());
  const start = (s: SetupRecord, prompt: string) => write.mutateAsync(() => api.start(s.environment, prompt));
  return { start, starting: write.isPending };
}

export function SessionsPage({ board = false }: { board?: boolean }) {
  const [query, setQuery] = useState("");
  const answer = useApi<Summary[]>("sessions");
  const { environments, repos, agents } = useStarting();
  // The plane has no search: the words filter the list here, on title and first prompt.
  const q = query.trim().toLowerCase();
  const rows = (answer.data ?? []).filter((s) => !q || `${s.title ?? ""} ${s.prompt}`.toLowerCase().includes(q));
  const sessions: Load<SessionRecord[]> = answer.data ? load.value(rows.map((s) => sessionOf(s, environments))) : answer.error ? load.failed(message(answer.error)) : "loading";
  const [failure, setFailure] = useState<string>();

  return (
    <SessionsScreen
      key={board ? "board" : "list"}
      sessions={sessions}
      repos={repos}
      agents={agents}
      query={query}
      board={board}
      error={failure}
      // The window's dialog: the session it starts opens in its own tab.
      create={() => store.overlay({ kind: "newSession" })}
      actions={{
        search: (text) => setQuery(text),
        // The plane keeps no archive: Archive deletes the session and its fork.
        archive: (id) =>
          void api
            .remove(id)
            .then(() => setFailure(undefined))
            .catch((e) => setFailure(`Not removed: ${message(e)}`))
            .finally(() => void stale("sessions")),
        dismissError: () => setFailure(undefined),
      }}
    />
  );
}

// The new session dialog over the window (⌘N, the commander, the + of the tab strip); the session it starts opens in
// a tab of its own. It opens on the message, on the last setup kept; with none (a workspace's first session), it walks
// the steps from the agent.
export function NewSessionPage({ repo, close }: { repo?: string; close: () => void }) {
  const { repos, choices, agents, ready } = useStarting();
  const { start, starting } = useStart();
  const [error, setError] = useState<string>();
  const ws = workspace() ?? "";
  const last = lastSetup(ws);
  const named = repos.filter((r) => r.id === repo).map((r) => r.name);
  return (
    <div className="absolute inset-0 z-40">
      <NewSessionDialog
        // Built again once the lists arrive, so its setup reads them.
        key={`${ready}`}
        environments={choices}
        agents={agents}
        setup={setup.first(agents, choices, last, named)}
        at={last || named.length ? "message" : "agent"}
        starting={starting}
        error={error}
        dictate={listen}
        close={close}
        start={(s, prompt) => {
          setError(undefined);
          start(s, prompt)
            .then((session) => {
              const made = sessionOf(session);
              started(ws, s);
              close();
              store.navigate(paths.session(made.id), "tab", made.title);
            })
            .catch((e) => setError(message(e)));
        }}
      />
    </div>
  );
}
