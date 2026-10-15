import { createContext, useContext, useSyncExternalStore } from "react";
import { describe, objectTitle, place, same } from "@h0/ui";

// A tab shows a path (a page of the app).
export type Tab = { id: string; title: string; glyph: string; path?: string; url?: string };

// What floats over the window, one at a time.
export type Overlay = { kind: "commander" } | { kind: "newSession"; repo?: string } | { kind: "newWorkspace" } | { kind: "theme" };

// "new": always a tab of its own (+ opens Home in one).
export type Opening = "tab" | "here" | "new";

// A place a tab showed, kept for the commander's Recent group.
export type Recent = { path?: string; url?: string; title: string; glyph: string };

type State = { tabs: Tab[]; active?: string; overlay?: Overlay; recent: Recent[] };

// Places the commander lists under Recent, and how many the store keeps behind them (the current tab and the
// closed ones drop out of the list, so it keeps more than it shows).
export const recentShown = 4;
const recentKept = 12;

const saved = "h0.tabs";
const savedRecent = "h0.recent";
const savedDrafts = "h0.drafts";

// What a place is, whatever its view: an object's path, or a web address.
const placeOf = (r: { path?: string; url?: string }) => (r.path ? (place(r.path) ?? r.path) : r.url);

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    // Unreadable saved state starts over.
  }
  return fallback;
}
const listeners = new Set<() => void>();

function initial(): State {
  try {
    const raw = localStorage.getItem(saved);
    if (raw) {
      const s = JSON.parse(raw) as State;
      // One tab per object: a copy saved before that rule is dropped.
      const tabs = s.tabs.filter((t, i) => (t.path || t.url) && !s.tabs.slice(0, i).some((o) => o.path && t.path && same(o.path, t.path)));
      if (tabs.length) return { tabs, active: tabs.some((t) => t.id === s.active) ? s.active : tabs[0].id, recent: read<Recent[]>(savedRecent, []) };
    }
  } catch {
    // Unreadable saved tabs start over.
  }
  const first = tab("/sessions");
  return { tabs: [first], active: first.id, recent: read<Recent[]>(savedRecent, []) };
}

let state: State = initial();
// The composer's draft by session id: its text and whether the Note switch is on, kept together across launches so
// words written as a note come back as a note, and cleared when sent. A draft saved as plain text is a message's.
type Draft = { text: string; note: boolean };
let drafts: Record<string, Draft> = Object.fromEntries(
  Object.entries(read<Record<string, Draft | string>>(savedDrafts, {})).map(([id, d]) => [id, typeof d === "string" ? { text: d, note: false } : d]),
);

function tab(path: string, title?: string): Tab {
  const d = describe(path);
  return { id: crypto.randomUUID(), path, title: title ? objectTitle(path, title) : d.title, glyph: d.glyph };
}

// The tab in view goes to the head of the recent places, once, with its current title.
function remember(next: State): State {
  const current = next.tabs.find((t) => t.id === next.active);
  // Home is not a place: each + opens its own.
  const key = current && (current.path && place(current.path) === undefined ? undefined : placeOf(current));
  if (!current || !key) return next;
  const entry: Recent = { path: current.path, url: current.url, title: current.title, glyph: current.url ? "globe" : current.glyph };
  const recent = [entry, ...next.recent.filter((r) => placeOf(r) !== key)].slice(0, recentKept);
  return { ...next, recent };
}

function set(next: Partial<State>) {
  state = remember({ ...state, ...next });
  try {
    localStorage.setItem(saved, JSON.stringify({ tabs: state.tabs, active: state.active }));
    localStorage.setItem(savedRecent, JSON.stringify(state.recent));
  } catch {
    // Tabs are kept when storage allows it.
  }
  listeners.forEach((l) => l());
}

export const store = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  // An object shows in one tab only: whatever the opening, a tab already showing it is selected, and it keeps its
  // view unless the path names one. Otherwise, from the commander ("tab") a new tab; from a link ("here") the
  // current tab takes the path's title and content.
  navigate(path: string, opening: Opening = "here", title?: string) {
    const current = state.tabs.find((t) => t.id === state.active);
    const shows = (t?: Tab) => !!t?.path && same(t.path, path);
    const open = shows(current) ? current : state.tabs.find(shows);
    const here = !open && opening === "here" ? current : undefined;
    const target = open ?? here;
    if (target) {
      // The current tab moving within its object (a view switch) always takes the path.
      const moves = here || (opening === "here" && open === current) || path !== place(path);
      if (!moves) {
        set({ active: target.id, overlay: undefined });
        return;
      }
      const d = describe(path);
      // A tab keeps the name its page gave it while it shows the same object; a settings tab takes its page's.
      const named = shows(target) && place(path) !== "/settings" ? target.title : d.title;
      set({ tabs: state.tabs.map((t) => (t.id === target.id ? { ...t, path, url: undefined, title: title ? objectTitle(path, title) : named, glyph: d.glyph } : t)), active: target.id, overlay: undefined });
      return;
    }
    const next = tab(path, title);
    set({ tabs: [...state.tabs, next], active: next.id, overlay: undefined });
  },

  select(id: string) {
    set({ active: id });
  },

  // A tab dragged along the strip: the tab at `from` now stands at `to`. The active tab stays active.
  move(from: number, to: number) {
    const tabs = [...state.tabs];
    const [moved] = tabs.splice(from, 1);
    if (!moved || to < 0 || to > tabs.length || from === to) return;
    tabs.splice(to, 0, moved);
    set({ tabs });
  },

  // A place from the Recent group: its tab if one is open, else a tab of its own titled as it was.
  reopen(entry: Recent) {
    if (!entry.path) return;
    const open = state.tabs.find((t) => t.path && same(t.path, entry.path!));
    if (open) return store.navigate(entry.path, "tab");
    const next: Tab = { id: crypto.randomUUID(), title: entry.title, glyph: entry.glyph, path: entry.path };
    set({ tabs: [...state.tabs, next], active: next.id, overlay: undefined });
  },

  // The unsent draft of a session: its text and its Note switch. Changes are kept at once and wake nobody: the composer
  // holds its own. A draft with no text and the switch off is forgotten.
  draft: {
    get: (session: string): Draft => drafts[session] ?? { text: "", note: false },
    set(session: string, change: Partial<Draft>) {
      const next = { ...(drafts[session] ?? { text: "", note: false }), ...change };
      drafts = { ...drafts, [session]: next };
      if (!next.text && !next.note) delete drafts[session];
      try {
        localStorage.setItem(savedDrafts, JSON.stringify(drafts));
      } catch {
        // Drafts are kept when storage allows it.
      }
    },
  },

  // The last tab stays: the window always shows a place.
  close(id: string) {
    const i = state.tabs.findIndex((t) => t.id === id);
    if (i < 0 || state.tabs.length <= 1) return;
    const tabs = state.tabs.filter((t) => t.id !== id);
    set({ tabs, active: state.active === id ? tabs[Math.min(i, tabs.length - 1)]?.id : state.active });
  },

  // A page names its tab once it reads its item (a session's title, an environment's name).
  retitle(path: string, name: string) {
    const title = objectTitle(path, name);
    if (!state.tabs.some((t) => t.path === path && t.title !== title)) return;
    set({ tabs: state.tabs.map((t) => (t.path === path ? { ...t, title } : t)) });
  },

  overlay(overlay?: Overlay) {
    set({ overlay });
  },

};

export function useStore<T>(pick: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => pick(store.get()));
}

// The id of the tab a page shows in.
export const CurrentTab = createContext("");
export const useCurrentTab = () => useContext(CurrentTab);
