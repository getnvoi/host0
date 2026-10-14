import { useContext, useEffect, useRef, useState } from "react";
import { TabStrip } from "../../chrome";
import { Toast, ToastLayer } from "../../conversation";
import { DayList, GroupHead, SkeletonRows } from "../../data";
import { ConfirmDialog } from "../../heads";
import { listEmpty, ListPage } from "../../lists";
import { menu } from "../../menu";
import { Button, Segments } from "../../primitives";
import { Board } from "../../start";
import { ShowsTabStrip, useNavigate } from "../navigate";
import { paths } from "../routes";
import { sessionSamples } from "./samples";
import { NewSessionDialog, type EnvironmentChoice, type SetupRecord } from "./setup";
import { load, type AgentRecord, type Load, type RepoRecord, type SessionRecord } from "./records";
import { sessionState } from "./state";

// How many sessions a page of the list shows, never cutting a day.
// Tunable by a workspace (issue #33).
const sessionsPageSize = 20;

// What the sessions list asks the API to do.
export type SessionsActions = {
  // `GET /sessions?q=` and `GET /sessions?q=&archived=true`: the query. The screen takes both answers in one list.
  search?: (query: string) => void;
  // `PATCH /sessions/{id}` with `archived: true`.
  archive?: (id: string) => void;
  // `PATCH /sessions/{id}` with `archived: false`.
  restore?: (id: string) => void;
  // `POST /sessions`: the setup the dialog chose and the first message.
  start?: (setup: SetupRecord, prompt: string) => void;
  // Clears `error` and `startError` once read.
  dismissError?: () => void;
};

export type SessionsScreenProps = {
  sessions: Load<SessionRecord[]>;
  repos?: RepoRecord[];
  agents?: AgentRecord[];
  environments?: EnvironmentChoice[];
  query?: string;
  // The search is waiting for its answer.
  searching?: boolean;
  now?: Date;
  // The new session dialog open.
  creating?: boolean;
  board?: boolean;
  // A list action that failed, in the API's words.
  error?: string;
  // The dialog's start under way, and its refusal.
  starting?: boolean;
  startError?: string;
  actions?: SessionsActions;
  // Opens the window's new session dialog in place of this screen's own.
  create?: () => void;
};

// The workspace's sessions by day, as a list or a board; New session opens the dialog.
export function SessionsScreen({
  sessions, repos = sessionSamples.repos, agents = sessionSamples.agents, environments = [], query: initialQuery = "", searching, now = new Date(),
  creating: initialCreating = false, board = false, error, starting = false, startError, actions = {}, create,
}: SessionsScreenProps) {
  const navigate = useNavigate();
  const strip = useContext(ShowsTabStrip);
  const [creating, setCreating] = useState(initialCreating);
  const [layout, setLayout] = useState(board ? 1 : 0);
  const [query, setQuery] = useState(initialQuery);
  // The list also shows the archived sessions among its rows, by day.
  const [shownArchived, setShownArchived] = useState(false);
  const all = load.get(sessions) ?? [];
  // The toggle is offered only while the answer holds an archived session.
  const anyArchived = all.some((s) => s.archived);
  const included = shownArchived && anyArchived;
  // The API matches the query on title, repository and transcript; the list drops the archived ones unless shown.
  const kept = all.filter((s) => included || !s.archived);
  const place = layout === 1 ? { title: "Board", glyph: "board" } : { title: "Sessions", glyph: "session" };
  const search = useRef(actions.search);
  search.current = actions.search;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    search.current?.(query);
  }, [query]);
  // An archived session asks first: it is restored from a dialog, not opened.
  const [restoring, setRestoring] = useState<SessionRecord>();
  const open = (id: string, title: string) => navigate(paths.session(id), "here", title);
  const pick = (id: string, title: string) => {
    const found = all.find((s) => s.id === id);
    if (found?.archived) setRestoring(found);
    else open(id, title);
  };
  return (
    <div className="relative flex h-full flex-col bg-page">
      {strip && <TabStrip tabs={[{ title: place.title, glyph: place.glyph }, { title: "Inbox", glyph: "inbox" }]} active={0} />}
      <div className="min-h-0 flex-1">
        <ListPage
          title={layout === 1 ? place.title : "Sessions"}
          glyph={place.glyph}
          state={load.list(sessions)}
          total={kept.length}
          shown={kept.length}
          query={query}
          onQuery={setQuery}
          searching={searching}
          scrollTop
          empty={listEmpty("session", { noun: "session", plural: "sessions", text: "Start one on a repository: the agent works on a new branch on a fresh machine." })}
          retry={() => actions.search?.(query)}
          wide={layout === 1}
          filters={
            // List and Board are two places: the choice moves the tab.
            <Segments
              items={["List", "Board"]}
              glyphs={["bullets", "board"]}
              selection={layout}
              onChange={(n) => {
                setLayout(n);
                navigate(n === 1 ? paths.board : paths.sessions);
              }}
            />
          }
          action={
            <Button kind="primary" size="small" glyph="plus" onClick={() => (create ? create() : setCreating(true))}>
              New session
            </Button>
          }
          rows={
            <DayList
              groups={sessionState.days(kept, now, (s) => s.updatedAt).map(([title, list]) => ({ title, rows: list.map((s) => sessionState.row(s, repos, now)) }))}
              open={(r) => pick(r.id, r.title)}
              pageSize={sessionsPageSize}
              aside={anyArchived ? { text: included ? "Hide archived" : "Show archived", glyph: "archive", onClick: () => setShownArchived(!included) } : undefined}
              menu={(r) => [
                menu.item("Go to conversation", { glyph: "session", action: () => open(r.id, r.title) }),
                menu.divider,
                // Live: archive it; archived: restore it.
                r.off
                  ? menu.item("Restore", { glyph: "restore", action: () => actions.restore?.(r.id) })
                  : menu.item("Archive", { glyph: "archive", destructive: true, action: () => actions.archive?.(r.id) }),
              ]}
            />
          }
          loading={
            <div className="flex flex-col">
              <GroupHead title="Today" size="medium" />
              <SkeletonRows count={4} />
            </div>
          }
          fullLoading={
            <div className="min-h-0 flex-1">
              <Board lanes={sessionState.lanes([], repos, now)} loading />
            </div>
          }
          full={
            <div className="min-h-0 flex-1">
              {/* The lanes are the latest turn's status (`SessionResource#status`); no API call moves a session between
                  them, so its cards do not drag. */}
              <Board
                locked
                lanes={sessionState.lanes(kept, repos, now)}
                open={(card) => {
                  const s = kept.find((k) => k.id === card.id);
                  if (s) open(s.id, s.title);
                }}
              />
            </div>
          }
        />
      </div>
      {restoring && (
        <ConfirmDialog
          title="Restore this session?"
          message={`“${restoring.title}” is archived. Restoring puts it back in the live list.`}
          action="Restore"
          glyph="restore"
          destructive={false}
          confirm={() => {
            actions.restore?.(restoring.id);
            setRestoring(undefined);
          }}
          cancel={() => setRestoring(undefined)}
        />
      )}
      {creating ? (
        <NewSessionDialog
          agents={agents}
          environments={environments}
          starting={starting}
          error={startError}
          start={(setup, prompt) => actions.start?.(setup, prompt)}
          close={() => {
            setCreating(false);
            actions.dismissError?.();
          }}
        />
      ) : (
        error && (
          <ToastLayer>
            <Toast text={error} tone="red" close={actions.dismissError} />
          </ToastLayer>
        )
      )}
    </div>
  );
}
