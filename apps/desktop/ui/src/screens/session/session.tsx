import { Fragment, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useDictation, type Dictate } from "./dictation";
import { hasFailed, useDelayedBusy } from "../../busy";
import { ArtifactCard, Thumbnail, VisualCard, type SavedVersion } from "../../cards";
import { TabStrip, type TabInfo } from "../../chrome";
import { Backdrop } from "../../clickable";
import { CommanderOverlay, AccountMenu, rowId, type CommanderGroup, type CommanderRow } from "../../commander";
import { ShortcutsDialog } from "../../shortcuts";
import { shortcutGroups } from "../shortcuts";
import { ComposerBox, composerGate, type Attachment, type ComposerBadges, type ComposerGate, type ComposerMode, type Mentionables } from "../../composer";
import {
  ConversationActivityCard, ErrorBlock, TurnTally, Note, NoteThread, Notice, Prose, SubagentCard, TerminalBlock, Toast, TurnHead, UserMessage, WorkingLine,
  type DiffLine, type GateAnswer, type LiveTerminalStatus, type TerminalLine,
  ConversationScroll,
} from "../../conversation";
import { ConfirmDialog, Drawer, SessionHead, sessionTools, type FileChange, type PullRequest, type SessionTool } from "../../heads";
import type { MenuEntry } from "../../menu";
import { Captures, Lightbox, lightboxItem, type LightboxItem } from "../../media";
import { ChangesPane, FilesPane, PreviewPane, TerminalPane, type ChangesFile, type ChangesPaneState, type FilesPaneFile, type FilesPaneState, type PreviewPaneState, type TerminalPaneState } from "../../panes";
import { Button, LoadingState, SectionLabel, type Person } from "../../primitives";
import { Pane, Split, type PaneTab } from "../../split";
import { SectionHead } from "../../data";
import { EmptyState, ErrorState } from "../../start";
import { measure, type Tone } from "../../tokens";
import { artifactModel, type ArtifactModel, type ConversationModel, type WorkingModel } from "../models";
import { ShowsTabStrip, useNavigate } from "../navigate";
import { paths, settingsPages } from "../routes";
import { samples } from "../samples";
import { sessionSamples } from "./samples";
import {
  load, project, sessionDetail, words, type ChangesRecord, type FileRecord, type FilesRecord, type Load, type LogLine, type LogsRecord, type MachineRecord,
  type OutputRecord, type ProcessRecord, type SessionDetail, type StopRecord, type TerminalRecord, type WorktreeRecord,
} from "./records";
import { runRow, Transcript, type PendingCall, type TranscriptItem } from "./transcript";
import { machineEntries, ProcessDrawer, ProcessStopDialog, type LogStream, type ProcessStop, type Signal } from "./machine";

// What a session shows besides its conversation, as its path names it: the preview in the pane (1), or a tool of the
// checkout in the large drawer (2 Files, 3 Changes, 4 Terminal).
export const viewPaths = ["", "preview", "files", "changes", "terminal"] as const;
const toolViews: SessionTool[] = ["files", "changes", "terminal"];

// What a session's page asks the API to do. Each maps to one call; the app performs it.
export type SessionActions = {
  // `POST /sessions/{id}/messages` with the prompt; `to`, the sub-agent whose conversation shows, gets it: the main
  // agent passes it on, and it is drawn in that sub-agent's conversation.
  // `files`: what the person attached to the message.
  send?: (prompt: string, to?: string, files?: File[]) => void;
  // `POST /sessions/{id}/messages` with the prompt and `steer`, then `DELETE /sessions/{id}/turns/{turn_id}`: a
  // queued message reaches the running agent now instead of after the turn.
  sendNow?: (turnId: string) => void;
  // `POST /sessions/{id}/notes` with the body.
  note?: (body: string) => void;
  // Dictation, by the app's recognizer: starts listening and answers how to stop it. `heard` gets the words said so
  // far (those settled, then those still guessed); `ended` once it stopped, with why when it could not listen.
  dictate?: Dictate;
  // `POST /sessions/{id}/approvals`: the call's `tool_use_id`, approve or reject.
  decide?: (toolUseId: string, approve: boolean) => void;
  // `DELETE /sessions/{id}/turns/{turn_id}`: stops a running turn or withdraws a queued one.
  cancel?: (turnId: string) => void;
  // `POST /sessions/{id}/notes/{note_id}/send`.
  sendNote?: (noteId: string) => void;
  // `POST /worktrees/{worktree_id}/preview`.
  serve?: (worktreeId: string) => void;
  // `POST /worktrees/{worktree_id}/ship`: a person merges the branch into main, on a repository nvoi hosts.
  ship?: (worktreeId: string) => void;
  // `PATCH /sessions/{id}` with `archived: false`.
  restore?: () => void;
  // `GET /sessions/{id}/file?path=`.
  openFile?: (path: string) => void;
  // Opens a link (the preview's address, the pull request).
  openLink?: (url: string) => void;
  // Loads the preview's page again.
  reloadPreview?: () => void;
  // Saves a message's file (its `url`, signed) under its name.
  download?: (url: string, name: string) => void;
  // `POST /sessions/{id}/approvals` with `decision: approve`, the questions' `answers` and `notes` by index.
  answer?: (toolUseId: string, answer: GateAnswer) => void;
  // `POST /sessions/{id}/notes` with `parent_id`: a reply to the note.
  reply?: (noteId: string, body: string) => void;
  // `GET /sessions/{id}/logs`: the machine's log, shown in a drawer.
  openLogs?: () => void;
  // `GET /sessions/{id}/machine`: memory, CPU, disk and processes, read each time the head's machine menu opens.
  openMachine?: () => void;
  // `POST /sessions/{id}/machine/kill` with the pid and TERM or KILL.
  stopProcess?: (pid: number, signal: Signal) => void;
  // `GET /sessions/{id}/machine/processes/{pid}/output`: a process's log, for its drawer, on open and Refresh; then
  // its stream over the terminal server's socket, which `closeOutput` stops when the drawer closes.
  openOutput?: (pid: number) => void;
  closeOutput?: () => void;
  // A line typed in the terminal, sent over its socket.
  type?: (line: string) => void;
  // `POST /sessions/{id}/terminal` again after the socket closed.
  reconnect?: () => void;
  // What shows besides the conversation changed, on arrival too (0 nothing, 1 the preview in the pane, 2 Files,
  // 3 Changes, 4 Terminal in the drawer): the app reads what it shows. Opening Terminal starts a stopped machine.
  view?: (view: number) => void;
  // `GET /sessions/{id}/files` again.
  reloadFiles?: () => void;
  // Clears `error` once read.
  dismissError?: () => void;
};

// What the views beside the conversation read, each loaded on its own.
export type SessionPanes = {
  // The answer to `POST /worktrees/{id}/preview`: undefined until asked, loading while it queues.
  serve?: Load<WorktreeRecord>;
  changes?: Load<ChangesRecord>;
  files?: Load<FilesRecord>;
  // The file open in Files, undefined when none is.
  file?: Load<FileRecord>;
  terminal?: Load<TerminalRecord>;
  // What the shell printed since the terminal opened.
  shell?: TerminalLine[];
  // The shell's socket once the machine runs.
  link?: LiveTerminalStatus;
  // The machine's log, shown in a drawer when set.
  logs?: Load<LogsRecord>;
  // The machine's reading, listed in the head's machine menu.
  machine?: Load<MachineRecord>;
  // The last process stopped from that menu.
  stop?: Load<StopRecord>;
  // The log of the process whose drawer is open, its stream's state and how many lines it streamed.
  output?: Load<OutputRecord>;
  stream?: LogStream;
  received?: number;
  // The environment's preview commands, which Start runs.
  commands?: string[];
  // The signed link `GET /sessions/{id}/preview` answers, shown while the checkout serves.
  preview?: string;
};

// What the screen draws, read from a session and its turns, or from the sample model of the shell.
type SessionPage = {
  tabs: TabInfo[];
  activeTab: number;
  workspace: string;
  initials: string;
  title: string;
  branch: string;
  changed: number;
  pullRequest: PullRequest;
  ship: boolean;
  groups: TranscriptItem[][];
  working?: WorkingModel;
  // The turn Stop cancels while the agent works.
  running?: string;
  pending: PendingCall[];
  badges: ComposerBadges;
  people: Person[];
  toast?: [string, Tone];
  archived: boolean;
  agent: string;
  worktree?: WorktreeRecord;
  environment?: { id: string; name: string };
  detail?: SessionDetail;
};

function fromDetail(detail: SessionDetail, tabs: TabInfo[], now: Date): SessionPage {
  const s = detail.session;
  const agent = detail.agent.name;
  const pr = s.worktree.pullRequest;
  const ship = pr?.ship ?? false;
  // On a repository nvoi hosts the agent opens the pull request inside nvoi, then a person ships it (merges into
  // main); on GitHub it is merged, open or none.
  const pullRequest: PullRequest = ship
    ? pr?.state === "merged" ? { kind: "shipped" } : pr?.state === "open" ? { kind: "ship" } : { kind: "create" }
    : pr?.url && pr.state === "merged"
      ? { kind: "merged", url: pr.url }
      : pr?.url && pr.state === "open"
        ? { kind: "open", url: pr.url }
        : { kind: "create" };
  const activity = Transcript.activity(detail);
  let working: WorkingModel | undefined;
  if (activity) {
    const time = words.clock(words.between(activity.since, now));
    working =
      activity.kind === "preparing"
        ? { text: Transcript.resumed(detail) ? "Starting the machine" : "Setting up the machine", tone: "orange", time, action: "Open log" }
        : activity.kind === "waiting"
          ? { text: `${agent} is waiting on you`, tone: "yellow", time }
          : { text: `${agent} is working`, tone: "blue", time };
  }
  return {
    tabs, activeTab: tabs.length - 1, workspace: "Northwind", initials: "BB", title: s.title, branch: s.worktree.branch, changed: pr?.changed ?? 0, pullRequest, ship,
    groups: Transcript.groups(detail), working, running: activity?.kind === "working" ? detail.turns.find((t) => ["pending", "running"].includes(t.status))?.id : undefined,
    pending: Transcript.pending(detail), badges: { agent, model: detail.agent.model ?? undefined, repos: [project(detail.repo)], environment: sessionDetail.environment(detail)?.name, branch: s.worktree.branch, machine: words.machine(s.worktree.state) }, people: [],
    archived: s.archived, agent, worktree: s.worktree, environment: sessionDetail.environment(detail), detail,
  };
}

function fromModel(model: ConversationModel): SessionPage {
  return {
    tabs: model.tabs, activeTab: model.activeTab, workspace: model.workspace, initials: model.initials, title: model.title, branch: model.branch, changed: model.changes,
    pullRequest: { kind: "create" }, ship: false, groups: Transcript.fromParts(model.parts), working: model.working,
    pending: model.gate ? [{ toolUseId: model.gate.tool, question: false, title: model.gate.title, detail: [model.gate.tool, model.gate.detail].join(" · "), questions: [] }] : [],
    badges: model.badges, people: model.people, toast: model.toast, archived: false, agent: model.badges.agent,
  };
}

export type ConversationScreenProps = {
  // A session as the API serves it, or the shell's sample model.
  detail?: SessionDetail;
  // The composer's draft: its text and whether the Note switch is on, kept together by the page (the desktop keeps them
  // in localStorage, per session) and restored together, so words written as a note never come back as a message.
  // The page is told of each change.
  draft?: string;
  onDraftChange?: (text: string) => void;
  note?: boolean;
  onNoteChange?: (on: boolean) => void;
  model?: ConversationModel;
  panes?: SessionPanes;
  actions?: SessionActions;
  // 0 the conversation alone, 1 the preview in the pane, 2 Files, 3 Changes, 4 Terminal in the drawer.
  view?: number;
  // An action that failed, in the API's words, shown until `actions.dismissError`.
  error?: string;
  // Opens a sub-agent's conversation by its call's `tool_use_id`.
  thread?: string;
  // What Files and Changes open filtered by.
  query?: string;
  // Who watches the session (its presence channel), beside the composer's state.
  people?: Person[];
  // The live socket is down: the working line says "Reconnecting…" until it is back.
  reconnecting?: boolean;
  // For the gallery: dictation listening, or why it could not.
  listening?: boolean;
  dictationRefused?: string;
  // Who a note may name with `@`: the agents, then the members who reach the session.
  mentionables?: Mentionables;
  // The gallery's: the shortcuts dialog open.
  shortcutsShown?: boolean;
  // The gallery's window: tabs, the commander or the account menu over the session.
  tabs?: TabInfo[];
  now?: Date;
  commander?: boolean;
  menuOpen?: boolean;
  commanderGroups?: CommanderGroup[];
  // Where a commander row leads, by row id.
  routes?: Record<string, string>;
  // An artifact open in the pane, beside the preview when `view` is 1.
  artifact?: ArtifactModel;
  // Every saved version of the artifacts in the conversation, by artifact id, as the page loaded them: the card's
  // version menu lists them. A turn knows only the version it saved.
  versions?: Record<string, SavedVersion[]>;
  // How an artifact shows in the pane; by default its sections.
  artifactTab?: (artifact: ArtifactModel) => PaneTab;
  // The pane's width, fixed, and its divider drawn dragged: for the gallery.
  paneWidth?: number;
  dragging?: boolean;
  // A menu of the head drawn open, or a tool's drawer over the pane, for the gallery.
  headMenu?: "machine" | "tools";
  drawer?: SessionTool;
  // The machine menu's entries above Terminal: the box's processes.
  processes?: MenuEntry[];
  expanded?: boolean;
  // The gallery's lightbox, open over the conversation.
  lightbox?: { items: LightboxItem[]; at: number };
  // Drawn in the pane's Preview while the checkout serves, in place of the page frame (the native preview).
  previewFrame?: ReactNode;
  // Drawn in the Terminal drawer in place of the pane fed by `panes.terminal` (the app's shells in xterm).
  terminal?: ReactNode;
  // The gallery's machine overlays: a stop waiting on its confirm, a process's drawer.
  asking?: ProcessStop;
  detailed?: ProcessRecord;
};

const previewKey = "preview";
const artifactKey = (a: ArtifactModel) => `artifact:${a.id ?? a.title}`;

// An artifact's tab by default: its title and sections, on the pane's text column.
const defaultArtifactTab = (a: ArtifactModel): PaneTab => ({
  key: artifactKey(a),
  title: a.title,
  glyph: a.glyph,
  content: (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto flex w-full flex-col gap-5" style={{ maxWidth: measure.prose }}>
        <div className="flex flex-col gap-1">
          <span className="t-title text-ink">{a.title}</span>
          <span className="t-small text-tertiary">
            {a.author} · from {a.session} · {a.updated}
          </span>
        </div>
        {a.sections.map(([title, text], i) => (
          <SectionHead key={i} title={title} text={text} />
        ))}
      </div>
    </div>
  ),
});


// A session's window: the head, then a split: the transcript with the working line under the last turn and the
// composer on the left, the pane on the right when something shows in it (the preview, artifacts), each a tab at
// its foot. The checkout's tools (files, changes, terminal) open from the head in the large drawer.
export function ConversationScreen(props: ConversationScreenProps) {
  const {
    detail, model, panes = {}, actions = {}, error, thread: initialThread, query = "", commanderGroups = sessionSamples.commander, routes = {},
    previewFrame, terminal, artifactTab = defaultArtifactTab, paneWidth, dragging, headMenu, processes,
  } = props;
  // The working line's time runs on its own: read again every second while something is under way.
  const ticking = !props.now && !!detail && !!Transcript.activity(detail);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  const now = props.now ?? new Date(Math.max(clock, Date.now()));
  const navigate = useNavigate();
  const strip = useContext(ShowsTabStrip);
  const tabs0 = props.tabs ?? [{ title: "Sessions", glyph: "session" }, { title: detail?.session.title ?? "Session", glyph: "session" }];
  const read = detail ? fromDetail(detail, tabs0, now) : fromModel(model ?? samples.conversation);
  const page: SessionPage = props.reconnecting ? { ...read, working: { text: "Reconnecting…", tone: "grey" } } : read;
  const people = props.people ?? page.people;
  const [tabs, setTabs] = useState(page.tabs);
  const [activeTab, setActiveTab] = useState(page.activeTab);
  // The pane's tabs by key and the one shown; nothing while it is closed. Artifacts open in it are kept by key.
  const opening = (v?: number) => [...(v === 1 ? [previewKey] : []), ...(props.artifact ? [artifactKey(props.artifact)] : [])];
  const [pane, setPane] = useState<{ keys: string[]; active: string } | undefined>(() => {
    const keys = opening(props.view);
    return keys.length ? { keys, active: keys[0] } : undefined;
  });
  const [artifacts, setArtifacts] = useState<ArtifactModel[]>(props.artifact ? [props.artifact] : []);
  const [tool, setTool] = useState<SessionTool | undefined>(props.drawer ?? toolViews[(props.view ?? 0) - 2]);
  // Only the note is chosen, by the switch beside the send; Message or Queue follows the running state.
  const [noting, setNotingState] = useState(props.note ?? false);
  const setNoting = (on: boolean) => {
    setNotingState(on);
    props.onNoteChange?.(on);
  };
  // One draft: the switch changes who reads the words, not the words. It starts from the page's kept text and tells
  // the page of each change.
  const [draft, setDraftText] = useState(props.draft ?? "");
  // Files attached to the next message; a note carries none. An image shows its picture, from a URL of its own that
  // is let go once the file leaves the composer.
  const [files, setFiles] = useState<File[]>([]);
  const attached = useMemo<Attachment[]>(
    () => files.map((f) => ({ name: f.name, kind: f.type.startsWith("image/") ? "image" : "file", size: words.bytes(f.size), src: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined })),
    [files],
  );
  useEffect(() => () => attached.forEach((a) => a.src && URL.revokeObjectURL(a.src)), [attached]);
  const [commander, setCommander] = useState(!!props.commander);
  const [menu, setMenu] = useState(!!props.menuOpen);
  const [logs, setLogs] = useState(panes.logs !== undefined);
  // The note whose thread is open, by its id.
  const [noteThread, setNoteThread] = useState<string>();
  // A stop waiting on its confirm, and the process whose details show in the drawer.
  const [asking, setAsking] = useState<ProcessStop | undefined>(props.asking);
  const [detailed, setDetailed] = useState<ProcessRecord | undefined>(props.detailed);
  const [stopping, setStopping] = useState(false);
  // The list of shortcuts, from the composer's info button.
  const [keysShown, setKeysShown] = useState(props.shortcutsShown ?? false);
  const [thread, setThread] = useState(initialThread);
  // A message's files or a turn's captures, large, at one of them.
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; at: number } | undefined>(props.lightbox);


  const running = !!page.running;
  const mode: ComposerMode = noting ? "note" : running ? "queued" : "message";
  const setDraft = (text: string) => {
    setDraftText(text);
    props.onDraftChange?.(text);
  };
  const dictation = useDictation(actions.dictate, draft, setDraft, { listening: props.listening, refused: props.dictationRefused });
  // The path names one view: the preview shows in the pane, a tool in the drawer; the conversation alone closes
  // the drawer and leaves the pane as it is.
  useEffect(() => {
    if (props.view === undefined || props.drawer) return;
    setTool(toolViews[props.view - 2]);
    if (props.view === 1) showPane(previewKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.view]);
  const previewing = pane?.active === previewKey;
  const view = tool ? toolViews.indexOf(tool) + 2 : previewing ? 1 : 0;
  const tell = useRef(actions.view);
  tell.current = actions.view;
  useEffect(() => tell.current?.(view), [view]);

  // Shows the tab `key` in the pane, opening it.
  function showPane(key: string) {
    setPane((p) => (p ? { keys: p.keys.includes(key) ? p.keys : [...p.keys, key], active: key } : { keys: [key], active: key }));
  }
  const closeTab = (key: string) =>
    setPane((p) => {
      if (!p) return p;
      const keys = p.keys.filter((k) => k !== key);
      if (!keys.length) return undefined;
      const i = p.keys.indexOf(key);
      return { keys, active: p.active === key ? keys[Math.min(i, keys.length - 1)] : p.active };
    });
  const openArtifact = (a: ArtifactModel) => {
    // Opened again at another version, the artifact's tab shows that version.
    setArtifacts((list) => (list.some((x) => artifactKey(x) === artifactKey(a)) ? list.map((x) => (artifactKey(x) === artifactKey(a) ? a : x)) : [...list, a]));
    showPane(artifactKey(a));
  };
  const perform = (action?: string) => {
    if (action === "Open log") {
      actions.openLogs?.();
      setLogs(true);
    }
  };

  // The first call waiting on you takes the composer's gate: an approval to allow or deny, or questions to answer.
  const approval = page.pending.find((p) => !p.question);
  const question = page.pending.find((p) => p.question);
  const gate: ComposerGate | undefined = approval
    ? composerGate.approval(approval.title, approval.detail, undefined, approval.asked)
    : question
      ? question.questions.length
        ? composerGate.questions(question.questions, "", question.asked)
        : composerGate.approval(question.title, "Question", undefined, question.asked)
      : undefined;


  // Every sub-agent of the session, for the composer's tray, the latest first; a row shows its conversation in the
  // main one's place.
  const subagents = page.groups
    .flat()
    .flatMap((x) => (x.kind === "agents" && !x.steps ? x.runs : []))
    .reverse()
    .map((run) => ({ ...run, open: () => setThread(run.id) }));
  const viewed = subagents.find((run) => run.id === thread);
  // The main agent's facts in the list, from its latest turn: its time (so far while it runs), its tool calls, its
  // tokens (input and output).
  const latest = detail?.turns[detail.turns.length - 1];
  const mainFacts = latest
    ? (() => {
        const live = ["pending", "running"].includes(latest.status);
        const end = live ? now : latest.events.reduce((t, e) => (e.createdAt > t ? e.createdAt : t), latest.createdAt);
        const calls = latest.events.filter((e) => e.kind === "tool_use" && !e.parentToolUseId).length;
        const spend = latest.spend ? latest.spend.inputTokens + latest.spend.outputTokens : undefined;
        return [words.took(words.between(latest.createdAt, end)), calls ? words.plural(calls, "tool") : undefined, spend ? words.tokens(spend) : undefined].filter(Boolean).join(" · ") || undefined;
      })()
    : undefined;

  const item = (it: TranscriptItem): ReactNode => {
    switch (it.kind) {
      case "message":
        return (
          // The message starts on the turn's left edge, under the avatar: no indent.
          <div>
              <UserMessage
                author={it.author}
                initials={it.initials ?? ""}
                picture={it.picture}
                time={it.time}
                text={it.text}
                queued={it.queued ? `Queued until ${page.agent} finishes` : undefined}
                cancel={it.cancel && it.turnId ? () => actions.cancel?.(it.turnId!) : undefined}
                sendNow={it.cancel && it.queued && it.turnId ? () => actions.sendNow?.(it.turnId!) : undefined}
                from={it.from}
                to={it.to}
                files={it.files}
                open={it.files ? (at) => setLightbox({ items: it.files!.map(lightboxItem.file), at }) : undefined}
              />
          </div>
        );
      case "agent":
        return <TurnHead name={it.name} time={it.time} for={it.for} />;
      case "prose":
        return <Prose text={it.text} />;
      case "run":
        return <ConversationActivityCard summary={it.summary} time={it.time} rows={it.rows.map(runRow)} />;
      case "agents":
        // A workflow's steps stay in the conversation; sub-agents live in the composer's tray, at reach.
        return it.steps ? <SubagentCard title={it.title} runs={it.runs} /> : null;
      case "tally":
        return <TurnTally time={it.time} tools={it.tools} files={it.files} open={() => setTool("changes")} />;
      case "error":
        return <ErrorBlock title={it.title} text={it.text} />;
      case "note":
        return (
          <Note
            author={it.author}
            initials={it.initials}
            picture={it.picture}
            time={it.time}
            text={it.text}
            replies={it.replies}
            sent={it.sent}
            send={() => actions.sendNote?.(it.id)}
            thread={() => setNoteThread(it.id)}
          />
        );
      case "notice":
        return (
          <Notice
            text={it.text}
            tone={it.tone}
            title={it.title}
            action={it.action}
            perform={() => {
              if (it.action === "Open the environment" && page.environment) navigate(paths.environment(page.environment.id), "here", page.environment.name);
              else if (it.action === "Add a credential") navigate(paths.settings("credentials"));
            }}
          />
        );
      case "working":
        return <WorkingLine text={it.text} tone="blue" />;
      case "captures":
        return (
          <Captures
            captures={it.captures}
            open={(c) => {
              // Every capture of the turn, wherever the work placed it.
              const all = page.groups.flat().flatMap((x) => (x.kind === "captures" && x.turnId === it.turnId ? x.captures : []));
              const set = all.length ? all : it.captures;
              setLightbox({ items: set.map(lightboxItem.capture), at: Math.max(0, set.findIndex((x) => x.id === c.id)) });
            }}
          />
        );
      case "pullRequest":
        return (
          <VisualCard
            axis="horizontal"
            title={it.title}
            line={{ sub: it.branch }}
            excerpt={it.excerpt}
            open={() => actions.openLink?.(it.url)}
            visual={<Thumbnail kind="document" />}
            trailing={
              <Button size="small" onClick={() => actions.openLink?.(it.url)}>
                Open
              </Button>
            }
          />
        );
      case "artifact": {
        const a = it.artifact;
        return (
          <ArtifactCard
            title={a.title}
            line={artifactModel.meta(a)}
            excerpt={a.sections[0]?.[1]}
            visual={<Thumbnail kind={artifactModel.thumb(a)} />}
            version={a.version}
            versions={(a.id && props.versions?.[a.id]) || a.saved}
            open={(version?: number) => openArtifact(version === undefined || version === a.version ? a : { ...a, version })}
          />
        );
      }
    }
  };

  // Groups of the transcript, 48 apart, as the first is from the top; every block of a group fills the column, 12 from the next, the spacing inside a
  // message too (its head, its text, its files).
  const groupsView = (groups: TranscriptItem[][]) => (
    <div className="flex flex-col items-stretch gap-12">
      {groups.map((group, g) => (
        <div key={g} className="flex flex-col items-stretch gap-3">
          {group.map((it, i) => (
            <div key={i}>{item(it)}</div>
          ))}
        </div>
      ))}
    </div>
  );

  const shown = thread && page.detail ? Transcript.thread(page.detail, thread) : undefined;
  // One working line at a time, at the foot: a sub-agent's conversation gives its own words to it, never a second
  // spinner in its flow.
  const threadWorking = shown?.groups.flat().find((x): x is Extract<TranscriptItem, { kind: "working" }> => x.kind === "working");
  const threadGroups = shown?.groups.map((g) => g.filter((x) => x.kind !== "working")).filter((g) => g.length > 0);

  // The worktree as serving answered it, else as the session has it.
  const current = load.get(panes.serve) ?? page.worktree;
  const serve = () => current?.id && actions.serve?.(current.id);

  const toolBody = (() => {
    switch (tool) {
      case "files":
        return <FilesPane state={filesState(panes, page.worktree)} file={fileState(panes.file)} query={query} open={actions.openFile} reload={actions.reloadFiles} start={serve} />;
      case "changes":
        return <ChangesPane state={changesState(panes.changes, now)} query={query} retry={() => actions.view?.(3)} />;
      case "terminal":
        return terminal ?? <TerminalPane state={terminalState(panes)} lines={panes.shell} prompt="deploy@sandbox:/workspace$" input={actions.type} reconnect={actions.reconnect} />;
      default:
        return null;
    }
  })();

  const previewTab: PaneTab = {
    key: previewKey,
    title: "Preview",
    glyph: "preview",
    content: <PreviewPane state={previewState(panes, current)} commands={panes.commands} open={actions.openLink} reload={actions.reloadPreview} start={serve} frame={previewFrame} />,
  };
  const paneTabs = (pane?.keys ?? []).flatMap((key): PaneTab[] => {
    if (key === previewKey) return [previewTab];
    const a = artifacts.find((x) => artifactKey(x) === key);
    return a ? [artifactTab(a)] : [];
  });
  // The composer offers the preview once the environment has a preview command.
  const offersPreview = !!panes.commands?.length && !page.archived;

  return (
    <div className="relative flex h-full flex-col bg-page">
      {strip && (
        <TabStrip
          tabs={tabs}
          active={activeTab}
          onSelect={setActiveTab}
          onPlus={() => setCommander(true)}
          onClose={(i) => {
            if (tabs.length <= 1) return;
            const next = tabs.filter((_, k) => k !== i);
            setTabs(next);
            setActiveTab(Math.min(activeTab, next.length - 1));
          }}
        />
      )}
      <SessionHead
        people={people}
        title={page.title}
        back={paths.sessions}
        branch={page.branch}
        changes={page.changed}
        pullRequest={page.pullRequest}
        request={() =>
          page.pullRequest.kind === "ship" && page.worktree
            ? actions.ship?.(page.worktree.id)
            : actions.send?.("Commit the changes, push the branch and open a pull request.")
        }
        openLink={actions.openLink}
        tool={setTool}
        processes={
          processes ?? (!detail?.session.tab
            ? machineEntries(panes.machine, {
                ask: setAsking,
                details: (p) => {
                  actions.openOutput?.(p.pid);
                  setDetailed(p);
                },
                start: serve,
                retry: actions.openMachine,
                stop: panes.stop,
              })
            : [])
        }
        onMachine={actions.openMachine}
        menu={headMenu}
      />
      <Split
        width={paneWidth}
        dragging={dragging}
        pane={
          pane && paneTabs.length ? (
            <Pane tabs={paneTabs} active={pane.active} choose={showPane} close={closeTab} hide={() => setPane(undefined)} />
          ) : undefined
        }
      >
        <ConversationScroll
          anchor={page.groups.length + (page.working?.text ?? "")}
          working={
            page.working && (
              <WorkingLine text={threadWorking?.text ?? page.working.text} tone={page.working.tone} time={page.working.time} action={page.working.action} perform={() => perform(page.working?.action)} stop={page.running ? () => setStopping(true) : undefined} />
            )
          }
          composer={
            <ComposerBox
              focus
              mode={mode}
              onModeChange={(m) => setNoting(m === "note")}
              draft={draft}
              onDraftChange={setDraft}
              badges={page.badges}
              mentionables={props.mentionables}
              gate={gate}
              subagents={subagents}
              showing={thread}
              facts={mainFacts}
              subagentsShown={thread ? 1 : 0}
              showMain={() => setThread(undefined)}
              dictate={dictation.toggle}
              listening={dictation.listening}
              shortcuts={() => setKeysShown(true)}
              attachments={noting ? [] : attached}
              attach={noting ? undefined : (picked) => setFiles((all) => [...all, ...picked])}
              detach={(i) => setFiles((all) => all.filter((_, at) => at !== i))}
              send={() => {
                const text = draft.trim();
                if (!text) return;
                dictation.settle();
                if (noting) {
                  actions.note?.(text);
                  setNoting(false);
                } else {
                  actions.send?.(text, viewed?.id, files.length ? files : undefined);
                  setFiles([]);
                }
                setDraft("");
              }}
              stop={() => page.running && setStopping(true)}
              decide={(approve) => {
                const call = approval ?? question;
                if (call) actions.decide?.(call.toolUseId, approve);
              }}
              answer={(a) => question && actions.answer?.(question.toolUseId, a)}
              restore={page.archived ? () => actions.restore?.() : undefined}
              preview={offersPreview ? { shown: previewing, toggle: () => (previewing ? closeTab(previewKey) : showPane(previewKey)) } : undefined}
            />
          }
        >
          {/* The tray navigates: a sub-agent's conversation shows in the main one's place. */}
          {thread ? (
            shown ? (
              groupsView(threadGroups ?? [])
            ) : (
              <EmptyState glyph="bot" title="Nothing to show" text="This sub-agent's conversation is not in the session any more." />
            )
          ) : (
            <>
              {page.groups.length === 0 && <EmptyState glyph="session" title="No messages yet" text={`Write to ${page.agent} below to start the work.`} />}
              {groupsView(page.groups)}
            </>
          )}
        </ConversationScroll>
      </Split>
      {tool && (
        <Drawer size="large" title={sessionTools[tool].title} line={{ sub: page.branch }} lead={{ visual: sessionTools[tool].glyph }} close={() => setTool(undefined)}>
          {toolBody}
        </Drawer>
      )}
      {lightbox && (
        <Lightbox
          items={lightbox.items}
          at={lightbox.at}
          move={(at) => setLightbox({ ...lightbox, at })}
          close={() => setLightbox(undefined)}
          download={actions.download ? (i) => actions.download?.(i.src, i.download ?? i.title) : undefined}
        />
      )}
      {detailed && (
        <ProcessDrawer
          process={detailed}
          output={panes.output ?? "loading"}
          stream={panes.stream}
          received={panes.received}
          refresh={() => actions.openOutput?.(detailed.pid)}
          close={() => {
            actions.closeOutput?.();
            setDetailed(undefined);
          }}
        />
      )}
      {asking && (
        <ProcessStopDialog
          stop={asking}
          confirm={() => {
            actions.stopProcess?.(asking.process.pid, asking.signal);
            setAsking(undefined);
          }}
          cancel={() => setAsking(undefined)}
        />
      )}
      {logs && <LogsDrawer logs={panes.logs ?? "loading"} retry={actions.openLogs} close={() => setLogs(false)} />}
      {(() => {
        const open = noteThread ? page.groups.flat().find((x): x is Extract<TranscriptItem, { kind: "note" }> => x.kind === "note" && x.id === noteThread) : undefined;
        return open ? (
          <Drawer title="Thread" line={{ sub: `Note by ${open.author}` }} lead={{ visual: "pin" }} close={() => setNoteThread(undefined)}>
            <NoteThread note={{ author: open.author, initials: open.initials, picture: open.picture, time: open.time, text: open.text }} replies={open.replies} reply={(body) => actions.reply?.(open.id, body)} />
          </Drawer>
        ) : null;
      })()}
      {!commander && !menu && !tool && !lightbox && (error || dictation.refused || (page.toast && view === 0)) && (
        // Under the head, and the tab strip when this screen draws it.
        <div className="absolute right-4 z-20" style={{ top: strip ? 108 : 64 }}>
          {error ? (
            <Toast text={error} tone="red" close={actions.dismissError} />
          ) : dictation.refused ? (
            <Toast text="Dictation is not available" tone="red" detail={dictation.refused} action="Retry" perform={dictation.toggle} close={dictation.dismiss} />
          ) : (
            <Toast text={page.toast![0]} tone={page.toast![1]} action="View" />
          )}
        </div>
      )}
      {menu && (
        <div className="absolute inset-0 z-40">
          <Backdrop tint={false} close={() => setMenu(false)} />
          <div className="absolute top-11 right-4">
            <AccountMenu
              workspace={page.workspace}
              detail="3 members · Team plan"
              others={["Personal"]}
              name="Ben Bonnet"
              email="ben@northwind.dev"
              initials={page.initials}
              members={3}
              choose={(choice) => {
                setMenu(false);
                const p = settingsPages.find(([, title]) => title === choice);
                if (p) navigate(paths.settings(p[0]));
              }}
            />
          </div>
        </div>
      )}
      {commander && (
        <CommanderOverlay
          groups={commanderGroups}
          choose={(row: CommanderRow) => {
            setCommander(false);
            const path = route(row, routes);
            if (path) navigate(path, "tab");
          }}
          close={() => setCommander(false)}
        />
      )}
      {keysShown && <ShortcutsDialog groups={shortcutGroups} close={() => setKeysShown(false)} />}
      {stopping && (
        <ConfirmDialog
          title="Stop the agent?"
          message="It stops where it is. What it changed so far stays."
          action="Stop agent"
          glyph="stop"
          confirm={() => {
            if (page.running) actions.cancel?.(page.running);
            setStopping(false);
          }}
          cancel={() => setStopping(false)}
        />
      )}
    </div>
  );
}

// Where a commander row leads: the routes given by row id, else the pages named in Go to.
function route(row: CommanderRow, routes: Record<string, string>): string | undefined {
  const given = routes[rowId(row)];
  if (given) return given;
  if (row.title === "Inbox") return paths.inbox;
  if (row.title === "Sessions") return paths.sessions;
  if (row.title === "Board") return paths.board;
  if (row.title === "Settings") return paths.settings("members");
  const page = settingsPages.find(([, title]) => title === row.title);
  return page ? paths.settings(page[0]) : undefined;
}

// The preview's state: served with its link, asked to serve, served while its link is read, the machine failed,
// no preview command, or stopped.
export function previewState(panes: SessionPanes, current?: WorktreeRecord): PreviewPaneState {
  if (current?.serving && panes.preview) return { serving: panes.preview };
  if (panes.serve === "loading") return "starting";
  if (current?.serving && !panes.preview) return "starting";
  if (current?.state === "failed") return "failed";
  if (panes.serve && "failed" in panes.serve) {
    return panes.serve.code === "no_preview_command" ? { unavailable: panes.serve.failed } : { stopped: panes.serve.failed };
  }
  return { stopped: null };
}

function filesState(panes: SessionPanes, worktree?: WorktreeRecord): FilesPaneState {
  const files = panes.files ?? "loading";
  if (files === "loading") return "loading";
  if ("failed" in files) {
    if (files.code !== "not_running") return { failed: files.failed };
    const starting = panes.serve === "loading" || worktree?.state === "starting";
    return starting ? { starting: worktree?.branch ?? null } : "stopped";
  }
  const changes: Record<string, FileChange> = {};
  for (const c of files.value.changed ?? []) {
    if (changes[c.path]) continue;
    const s = c.status ?? "modified";
    changes[c.path] = s === "added" || s === "deleted" ? s : "modified";
  }
  return { paths: files.value.paths, changes, total: files.value.cut ? files.value.total : undefined };
}

function fileState(file?: Load<FileRecord>): FilesPaneFile {
  if (!file) return "none";
  if (file === "loading") return "loading";
  if ("failed" in file) return { failed: file.failed };
  const f = file.value;
  if (typeof f.text === "string") return { path: f.path, detail: f.size != null ? `${f.size} bytes` : undefined, text: f.text };
  return { path: f.path, hidden: f.message ?? "" };
}

export function changesState(changes: Load<ChangesRecord> = "loading", now: Date): ChangesPaneState {
  if (changes === "loading") return "loading";
  if ("failed" in changes) return { failed: changes.failed };
  const files = parsePatch(changes.value.patch);
  if (files.length) return { files };
  // `changes_empty_title` and `changes_empty_text`.
  if (!changes.value.patchAt) return { empty: ["No changes yet", "The diff is taken after each turn of the agent."] };
  return { empty: ["No changes", `Nothing differs from ${changes.value.baseRef ?? "the base branch"}, as of ${words.relative(changes.value.patchAt, now)}.`] };
}

function terminalState(panes: SessionPanes): TerminalPaneState {
  const t = panes.terminal ?? "loading";
  if (t === "loading") return "connecting";
  if ("failed" in t) return { failed: t.failed };
  if (t.value.state === "running") return { live: panes.link ?? "live" };
  if (t.value.state === "refused") return { refused: t.value.message ?? "The workspace cannot start another machine." };
  return "starting";
}

// Splits a unified diff by file. Added and context lines carry their new line number, removed lines their old one;
// context lines their old one too, for the split view.
export function parsePatch(patch: string): ChangesFile[] {
  const out: (ChangesFile & { added: number; removed: number; lines: DiffLine[] })[] = [];
  let line = 0;
  let old = 0;
  for (const raw of patch.split("\n")) {
    const last = out[out.length - 1];
    if (raw.startsWith("diff --git ")) {
      out.push({ path: raw.split(" b/").pop() ?? raw, added: 0, removed: 0, lines: [] });
    } else if (raw.startsWith("@@") && last) {
      // @@ -a,b +c,d @@: the old side starts at a, the new side at c.
      const parts = raw.split(" ");
      line = parseInt(parts.find((p) => p.startsWith("+"))?.slice(1).split(",")[0] ?? "1", 10) || 1;
      old = parseInt(parts.find((p) => p.startsWith("-"))?.slice(1).split(",")[0] ?? "1", 10) || 1;
    } else if (!last || ["+++", "---", "index ", "new file", "deleted file"].some((p) => raw.startsWith(p))) {
      continue;
    } else if (raw.startsWith("+")) {
      last.added++;
      last.lines.push({ number: line++, text: raw.slice(1), kind: "added" });
    } else if (raw.startsWith("-")) {
      last.removed++;
      last.lines.push({ number: old++, text: raw.slice(1), kind: "removed" });
    } else if (raw.startsWith(" ")) {
      last.lines.push({ number: line++, old: old++, text: raw.slice(1) });
    }
  }
  return out;
}

// The seed's state (`Seed#state`: missing, starting, running, failed) as a sentence.
function seedSentence(state: string) {
  if (state === "missing") return "The environment's seed machine is not built yet. Sessions start from it once it is ready.";
  if (state === "failed") return "The last build of the environment's seed machine failed. Sessions start from it once it is built.";
  return "The environment's seed machine is being built. Sessions start from it once it is ready.";
}

const logLines = (logs: LogLine[]): TerminalLine[] => logs.flatMap((l) => (l.output ? l.output.split("\n").filter(Boolean).map((text) => ({ text })) : [{ prompt: "$", text: l.step }]));

// The machine's log: the last deployment's steps and what they printed, and the seed machine's while it is built.
export function LogsDrawer({ logs, retry, close }: { logs: Load<LogsRecord>; retry?: () => void; close: () => void }) {
  let content: ReactNode;
  const held = useDelayedBusy(logs === "loading", hasFailed(logs));
  if (logs === "loading" || held) content = <LoadingState text="Reading the log" />;
  else if ("failed" in logs) content = <ErrorState title="The log did not load" message={logs.failed} retry={retry} />;
  else {
    const record = logs.value;
    const waiting = record.seed && !record.seed.built ? record.seed.state : undefined;
    const seedLogs = waiting ? (record.seedLogs ?? []) : [];
    content = (
      <div className="flex flex-col items-stretch gap-4">
        {waiting && <Notice text={seedSentence(waiting)} tone={waiting === "failed" ? "red" : "orange"} title={waiting === "failed" ? "The seed machine failed" : "Waiting for the seed machine"} />}
        {seedLogs.length > 0 && (
          <Fragment>
            {record.logs.length > 0 && <SectionLabel text="Seed machine" />}
            <TerminalBlock lines={logLines(seedLogs)} />
          </Fragment>
        )}
        {record.logs.length > 0 ? (
          <Fragment>
            {seedLogs.length > 0 && <SectionLabel text="This machine" />}
            <TerminalBlock lines={logLines(record.logs)} />
          </Fragment>
        ) : (
          !waiting && <EmptyState glyph="terminal" title="Nothing logged yet" text="The machine's steps show here as they run." />
        )}
      </div>
    );
  }
  return (
    <Drawer title="Machine log" line={{ sub: "The last deployment of this checkout" }} lead={{ visual: "terminal" }} close={close}>
      {content}
    </Drawer>
  );
}
