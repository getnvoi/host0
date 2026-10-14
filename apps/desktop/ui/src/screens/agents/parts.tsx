import { useState, type ReactNode } from "react";
import { hasFailed, useDelayedBusy } from "../../busy";
import { PageHead } from "../../heads";
import { LoadingState } from "../../primitives";
import { ErrorState } from "../../start";
import { useNavigate } from "../navigate";
import { agentSettings, agentSettingsPlace, objectOf, paths, settingsPages } from "../routes";
import { SettingsShell } from "../shell";
import type { Tone } from "../../tokens";

// The tabs of the agent settings pages: moving to one swaps the tab's page.
export function useAgentTabs(page: (typeof agentSettings)[number]) {
  const navigate = useNavigate();
  const titles = agentSettings.map((key) => settingsPages.find(([k]) => k === key)![1]);
  return { items: titles, selection: agentSettings.indexOf(page), onChange: (i: number) => navigate(paths.settings(agentSettings[i])), title: agentSettingsPlace.title, glyph: agentSettingsPlace.glyph };
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

// A form's edits over `original`. While nothing is edited the draft follows a new original (an answer, a restore);
// `dirty` says the draft differs from it.
export function useDraft<T>(original: T): [T, (next: T) => void, boolean] {
  const [draft, setDraft] = useState(original);
  const [base, setBase] = useState(original);
  let shown = draft;
  if (base !== original) {
    setBase(original);
    if (same(draft, base)) {
      setDraft(original);
      shown = original;
    }
  }
  return [shown, setDraft, !same(shown, original)];
}

// A record still loading, or that did not load; set by the live page.
export type Pending = "loading" | { failed: string };

// One record as a full page in the settings tab: its head (title, glyph, state, actions) over the form, or a spinner
// or the error while it is pending.
export function RecordPage({
  active, tab, title, glyph, noun, state, pending, retry, action, over, children,
}: {
  // The settings menu's title ("Agents").
  active: string;
  // The path the tab shows.
  tab: string;
  title: string;
  glyph: string;
  // "agent", for "This agent did not load".
  noun: string;
  state?: [string, Tone];
  pending?: Pending;
  retry?: () => void;
  action?: ReactNode;
  over?: ReactNode;
  children?: ReactNode;
}) {
  // The head's mark takes back to the page's list, in the same tab.
  const page = settingsPages.find(([, name]) => name === active);
  const list = page ? paths.settings(page[0]) : undefined;
  // The object first, then its name: "Skill · Release notes".
  const named = /^New /.test(title) ? title : `${objectOf(noun)} · ${title}`;
  const held = useDelayedBusy(pending === "loading", hasFailed(pending));
  return (
    <SettingsShell active={active} tab={tab} tabTitle={named} head={<PageHead title={named} glyph={glyph} back={list} state={pending ? undefined : state} action={pending ? undefined : action} />} over={over}>
      {pending === "loading" || held ? (
        <LoadingState />
      ) : pending ? (
        <ErrorState title={`This ${noun} did not load`} message={pending.failed} retry={retry} />
      ) : (
        <div className="flex flex-col items-stretch gap-10">{children}</div>
      )}
    </SettingsShell>
  );
}
