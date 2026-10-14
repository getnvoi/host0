// The window: signed out, the sign-in; a workspace not set up, onboarding; else the tabs, each a place (a page by its
// path), the sidebar, the commander (⌘T, ⌘K), the new session dialog (⌘N, +) and one overlay at a time.
import { useEffect, useState } from "react";
import { MemoryRouter, useParams, useRoutes } from "react-router-dom";
import {
  Button, CommanderOverlay, composerShortcuts, describe, destination, EmptyState, ErrorState, HiddenPages, LoadingState, NavigateContext, paths, rowId, same, settingsPages, ShowsTabStrip, Sidebar,
  TabStrip, Window, type CommanderGroup, type CommanderRow, type SettingsPage, type Tone,
} from "@hz/ui";
import { routes } from "./pages";
import { PageBoundary } from "./boundary";
import { OnboardingPage, SignInPage } from "./pages/start";
import { NewSessionPage } from "./pages/session/sessions";
import { ThemePage } from "./pages/settings/theme";
import { useAccount, useApi } from "./api/live";
import { sessionTitle } from "./api/session";
import { age, initials, reason, type Approval, type Summary } from "./api/models";
import { CurrentTab, recentShown, store, useStore, type Tab } from "./store";

// What this product has no page for: the design system's places and settings pages without a counterpart.
const hidden = ["Inbox", "Library", "Artifacts", "Members", "Roles", "Billing", "Repositories", "Connectors", "Profile", "Security"];

// A page with no route: its title, from the route alone.
function Pending() {
  const params = useParams();
  return <LoadingState text={Object.values(params).join(" ") || "Loading"} />;
}

// A tab's page, matched from its path alone, so a link, the commander and a restored tab land on the same thing.
function Page({ tab }: { tab: Tab }) {
  const page = useRoutes([...routes, { path: "*", element: <Pending /> }], tab.path);
  return (
    <CurrentTab.Provider value={tab.id}>
      <PageBoundary path={tab.path}>{page}</PageBoundary>
    </CurrentTab.Provider>
  );
}

function Surface() {
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.active);
  const tab = tabs.find((t) => t.id === active);
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-page">
      {tab?.path ? (
        <Page key={tab.id} tab={tab} />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            glyph="session"
            title="No tab open"
            text="Open a session or a page from the commander."
            action={
              <Button kind="primary" size="small" onClick={() => store.overlay({ kind: "commander" })}>
                Open the commander
              </Button>
            }
          />
        </div>
      )}
    </div>
  );
}

const goTo: string[] = [paths.sessions, paths.board, ...(["environments", "credentials", "usage"] as SettingsPage[]).map(paths.settings)];

// The session a path shows, whatever its view.
function sessionAt(path?: string): string | undefined {
  const [first, second] = (path ?? "").split("?")[0].split("/").filter(Boolean);
  return first === "sessions" ? second : undefined;
}

// What a session's tab says when it needs a look: a call waiting on you, else a session that failed.
function tabState(id: string, calls: Approval[], sessions: Summary[]): [string, Tone] | undefined {
  if (calls.some((a) => a.session === id && a.state === "pending")) return ["waiting for approval", "yellow"];
  if (sessions.find((s) => s.id === id)?.state === "failed") return ["failed", "red"];
  return undefined;
}

// The commander (⋮, ⌘T, ⌘K): sessions, actions, the pages to go to and the workspaces. A row opens its route's tab,
// or a new one.
function CommanderPage() {
  const [query, setQuery] = useState("");
  const { me, switchTo } = useAccount();
  const current = useStore((s) => s.tabs.find((t) => t.id === s.active));
  const visited = useStore((s) => s.recent);
  const q = query.trim().toLowerCase();
  const listed = useApi<Summary[]>("sessions");
  const all = listed.data ?? [];
  const sessions = q ? all.filter((s) => `${s.title ?? ""} ${s.prompt} ${s.env}`.toLowerCase().includes(q)) : all;
  const entries: [CommanderGroup, (() => void)[]][] = [];
  // Without words, the places last visited come first, the one in view left out.
  if (!q) {
    const away = visited.filter((r) => r.path && !(!!current?.path && same(r.path, current.path))).slice(0, recentShown);
    if (away.length) entries.push([{ title: "Recent", rows: away.map((r) => ({ title: r.title, lead: r.glyph, key: `recent ${r.path}` })) }, away.map((r) => () => store.reopen(r))]);
  }
  if (!q && listed.isPending) entries.push([{ title: "Sessions", rows: [], loading: true }, []]);
  else if (sessions.length) {
    entries.push([
      {
        title: "Sessions",
        rows: sessions.map((s) => ({ title: sessionTitle(s), subtitle: [s.env, age(s.last)].join(" · "), lead: "session", right: { pill: reason(s) }, key: `session ${s.id}` })),
        matched: !!q,
        list: true,
      },
      sessions.map((s) => () => store.navigate(paths.session(s.id), "tab", sessionTitle(s))),
    ]);
  }
  // The composer's shortcuts show on a session page only; the queued turn's while the session works.
  const onSession = sessionAt(current?.path);
  const working = all.find((s) => s.id === onSession)?.state === "running";
  const composer = onSession ? composerShortcuts.filter((c) => !c.queued || working) : [];
  entries.push([
    {
      title: "Actions",
      rows: [
        { title: "New session", lead: "plus", right: { keys: ["⌘", "N"] }, key: "new session" },
        ...composer.map((c) => ({ title: c.title, lead: c.lead, right: { keys: c.keys }, key: `shortcut ${c.key}` })),
        { title: "Close tab", lead: "close", right: { keys: ["⌘", "W"] }, key: "close tab" },
      ],
    },
    [
      () => store.overlay({ kind: "newSession" }),
      // The composer hears the key itself, so a row does what the shortcut does.
      ...composer.map((c) => () => void dispatchEvent(new KeyboardEvent("keydown", { key: c.key, metaKey: true, shiftKey: c.shift }))),
      () => current && store.close(current.id),
    ],
  ]);
  entries.push([
    { title: "Go to", rows: goTo.map((path) => ({ title: destination(path).title, lead: destination(path).glyph, key: path, right: destination(path).place ? { tag: destination(path).place! } : undefined })) },
    goTo.map((path) => () => store.navigate(path, "tab")),
  ]);
  if (me) {
    entries.push([
      { title: "Workspaces", rows: me.workspaces.map((w) => ({ title: w.name, lead: "repo", workspace: true, right: w.name === me.workspace?.name ? { check: true as const } : undefined, key: `workspace ${w.name}` })) },
      me.workspaces.map((w) => () => void (w.name === me.workspace?.name ? undefined : switchTo(w.name))),
    ]);
  }
  const runs = new Map<string, () => void>();
  entries.forEach(([group, actions]) => group.rows.forEach((row, i) => runs.set(rowId(row), actions[i])));
  return (
    <CommanderOverlay
      groups={entries.map(([g]) => g)}
      query={query}
      onQuery={setQuery}
      choose={(row: CommanderRow) => {
        store.overlay(undefined);
        runs.get(rowId(row))?.();
      }}
      close={() => store.overlay(undefined)}
    />
  );
}

function WindowStrip({ flush }: { flush: boolean }) {
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.active);
  const calls = useApi<Approval[]>("approvals").data ?? [];
  const sessions = useApi<Summary[]>("sessions").data ?? [];
  return (
    <TabStrip
      tabs={tabs.map((t) => {
        const id = sessionAt(t.path);
        const [state, tone] = id ? (tabState(id, calls, sessions) ?? []) : [];
        return { title: t.title, glyph: t.glyph, state, tone };
      })}
      active={Math.max(0, tabs.findIndex((t) => t.id === active))}
      lights={false}
      flush={flush}
      onSelect={(i) => store.select(tabs[i].id)}
      onClose={(i) => store.close(tabs[i].id)}
      onMove={(from, to) => store.move(from, to)}
      onPlus={() => store.overlay({ kind: "newSession" })}
      onMore={() => store.overlay({ kind: "commander" })}
    />
  );
}

// ⌘T and ⌘K open the commander, ⌘N a new session, ⌘W closes the tab.
const shortcuts: Record<string, () => void> = {
  t: () => store.overlay({ kind: "commander" }),
  k: () => store.overlay({ kind: "commander" }),
  n: () => store.overlay({ kind: "newSession" }),
  w: () => {
    const active = store.get().active;
    if (active) store.close(active);
  },
};

function useShortcuts() {
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      // ⌘⇧N and ⌘⇧W belong to the composer.
      if (!e.metaKey || e.shiftKey || !shortcuts[key]) return;
      e.preventDefault();
      if (!e.repeat) shortcuts[key]();
    };
    addEventListener("keydown", keydown);
    return () => removeEventListener("keydown", keydown);
  }, []);
}

// Whether the sidebar shows, kept across launches.
function useSidebar(): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem("hz.sidebar") === "1";
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem("hz.sidebar", open ? "0" : "1");
    } catch {
      // Kept when storage allows it.
    }
  };
  return [open, toggle];
}

// The sidebar's rows open their page as the commander does: the page's tab, else a new one.
function SidebarPage() {
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.active);
  const path = tabs.find((t) => t.id === active)?.path;
  const { me, logout, switchTo } = useAccount();
  const login = me?.user.login ?? "";
  const workspace = me?.workspace?.name ?? "";
  const places: Record<string, string> = { Sessions: paths.sessions, "Agent settings": paths.settings("credentials") };
  return (
    <Sidebar
      active={path ? describe(path).title : undefined}
      workspace={me ? { name: workspace, others: me.workspaces.map((w) => w.name).filter((n) => n !== workspace) } : undefined}
      account={me ? { name: me.user.name || login, email: `@${login}`, initials: initials(me.user.name || login) } : undefined}
      choose={(title) => {
        if (title === "Sign out") return void logout();
        if (title === "New workspace") return store.overlay({ kind: "newWorkspace" });
        if (title === "Theme") return store.overlay({ kind: "theme" });
        const page = settingsPages.find(([, t]) => t === title);
        const target = places[title] ?? (page ? paths.settings(page[0]) : undefined);
        if (target) return store.navigate(target, "tab");
        if (me?.workspaces.some((w) => w.name === title)) void switchTo(title);
      }}
    />
  );
}

// Signed out: sign in. A workspace not set up: onboarding. Else the tabs.
export function Shell() {
  useShortcuts();
  const [sidebar, toggle] = useSidebar();
  const overlay = useStore((s) => s.overlay);
  const { ready, me, onboarded, unreachable, retry } = useAccount();
  const first = useStore((s) => s.tabs[0]?.id === s.active);
  if (!ready) return unreachable ? <Unreachable failure={unreachable} retry={retry} /> : <div className="h-full bg-frame" />;
  if (!me) return <SignInPage />;
  if (overlay?.kind === "newWorkspace") return <OnboardingPage create />;
  if (onboarded === false || !me.workspace) return <OnboardingPage />;
  return (
    <MemoryRouter>
      <NavigateContext.Provider value={(path, opening, title) => store.navigate(path, opening, title)}>
        <ShowsTabStrip.Provider value={false}>
          <HiddenPages.Provider value={hidden}>
            <Window
              open={sidebar}
              first={first}
              toggle={toggle}
              strip={(flush) => <WindowStrip flush={flush} />}
              sidebar={<SidebarPage />}
              over={
                <>
                  {overlay?.kind === "commander" && <CommanderPage />}
                  {overlay?.kind === "theme" && <ThemePage close={() => store.overlay(undefined)} />}
                  {overlay?.kind === "newSession" && <NewSessionPage repo={overlay.repo} close={() => store.overlay(undefined)} />}
                </>
              }
            >
              <Surface />
            </Window>
          </HiddenPages.Provider>
        </ShowsTabStrip.Provider>
      </NavigateContext.Provider>
    </MemoryRouter>
  );
}

// The hub cannot be reached at launch: what it answered and when the next try runs, centred in the window.
function Unreachable({ failure, retry }: { failure: { message: string; next: number }; retry: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  const seconds = Math.max(0, Math.ceil((failure.next - now) / 1000));
  return (
    <div data-drag className="flex h-full items-center justify-center bg-page">
      <ErrorState title="Can't reach hz" message={`${failure.message} ${seconds > 0 ? `Trying again in ${seconds}s.` : "Trying again."}`} retry={retry} waiting={seconds > 0} />
    </div>
  );
}
