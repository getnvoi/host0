import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Accordion } from "./accordion";
import { cn } from "./cn";
import { Clickable } from "./clickable";
import { GateAnswer, QuestionBody, type GateQuestion } from "./conversation";
import { Glyph, glyphTrim, Turn } from "./glyph";
import { PageTabs } from "./heads";
import { AnchoredMenu, Dropdown, menu, Tooltip, type MenuEntry } from "./menu";
import { alpha, Button, Dot, edge, IconButton, Kbd, monoCaps, OnTone, RowMark, Rule, Spinner, tabStatus, Toggle, ToneStrip, type TabStatus } from "./primitives";
import { edgeInset, markSlot, palette, textEdge, tone, toneEdge, type Tone } from "./tokens";

// The composer's input asks for no autocorrection (nvoix's primitives hold this; nvoi design's do not).
const plainText = { autoComplete: "off", autoCorrect: "off", autoCapitalize: "off", spellCheck: false, writingsuggestions: "false" } as const;

// A file waiting to go with the next message. Always drawn as a square.
// A file attached to the next message. `src`: an image's picture (an object URL of the picked file); without it, the
// tile shows a wash until it comes.
export type Attachment = {
  name: string;
  kind: "image" | "file";
  size?: string;
  progress?: number;
  tint?: string;
  src?: string;
};

const ink = palette.ink;

export function AttachmentSquare({ file, remove }: { file: Attachment; remove?: () => void }) {
  const dot = file.name.lastIndexOf(".");
  const ext = dot > 0 ? file.name.slice(dot + 1).toUpperCase() : "";
  const stem = dot > 0 ? file.name.slice(0, dot) : file.name;
  return (
    <div className="relative size-16 shrink-0" title={[file.name, file.size].filter(Boolean).join(" · ")}>
      {file.kind === "image" ? (
        <div className="absolute inset-0 overflow-hidden rounded-control" style={{ background: `linear-gradient(to bottom right, ${file.tint ?? palette.fileWash}, ${palette.area})` }}>
          {file.src && <img src={file.src} alt={file.name} draggable={false} className="size-full object-cover" />}
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center rounded-control bg-page px-1.5 py-2">
          <div className="flex items-center gap-1">
            <Glyph name="file" size={13} color={palette.secondary} />
            <span className="font-mono text-[10px] text-secondary">{ext}</span>
          </div>
          <div className="flex-1" />
          <span className={cn("max-w-full truncate text-[10.5px] text-ink", file.progress !== undefined && "pb-1.5")}>{stem}</span>
        </div>
      )}
      {/* Its edge: a file's white tile on the white box would not show without it. */}
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-control" style={edge(palette.cardEdge)} />
      {file.progress !== undefined && (
        <div className="absolute inset-x-1.5 bottom-1.5 h-[3px] overflow-hidden rounded-full bg-ink/8">
          <div className="h-full rounded-full bg-ink" style={{ width: `${file.progress * 100}%` }} />
        </div>
      )}
      <Clickable fill="clear" radius={9} onClick={remove} label={`Remove ${file.name}`} handle={`button:Remove ${file.name}`} className="absolute -top-1.5 -right-1.5 flex">
        <RemoveMark />
      </Clickable>
    </div>
  );
}

// The round × on a file; it lightens while hovered.
export function RemoveMark() {
  return (
    <span className="flex size-[18px] items-center justify-center rounded-full bg-ink hovering:bg-secondary">
      <Glyph name="close" size={9} color={palette.onSolid} width={1.8} />
    </span>
  );
}

export type ComposerMode = "message" | "queued" | "note";

// The tray's context: the agent, then the branch on its machine, or, for a tab session, its tab.
export type ComposerBadges = {
  agent: string;
  // The model the agent runs (`AgentResource#model`), the repositories and the environment: badges in the box's foot.
  model?: string;
  environment?: string;
  repos: string[];
  branch?: string;
  machine?: { word: string; tone: Tone };
  // A tab session: no repository or machine, the tab it acts in.
  tab?: TabStatus;
};

// A call waiting on the person, shown in the tray above the context line: an approval (the call and its tool), or
// questions to answer one at a time. An approval with a `decider` waits on someone else and is read only. For a
// question gate, `detail` is what the head says on the right, after where the steps stand. `asked`: whose turn asked
// it, in a tooltip on the head's label. `allowable`: the call's tool may be allowed for the rest of the session.
export type ComposerGate = {
  title: string;
  detail: string;
  questions?: GateQuestion[];
  decider?: string;
  asked?: string;
  allowable?: boolean;
};

export const composerGate = {
  approval: (title: string, detail: string, decider?: string, asked?: string, allowable?: boolean): ComposerGate => ({ title, detail, decider, asked, allowable }),
  questions: (questions: GateQuestion[], detail = "", asked?: string): ComposerGate => ({ title: questions[0]?.question ?? "", detail, questions, asked }),
};

// A gate's label, with whose turn asked in its tooltip.
function GateLabel({ text, asked }: { text: string; asked?: string }) {
  const label = <span className="whitespace-nowrap">{text}</span>;
  return asked ? <Tooltip text={asked}>{label}</Tooltip> : label;
}

// A sub-agent of the session's last turn, as the tray lists it: its name, its last line, its state and facts. `open`
// opens its conversation.
export type ComposerSubagent = { id: string; name: string; line: string; state: "running" | "done" | "failed"; facts?: string; open?: () => void };

// How many sub-agents the tray shows before a "+ more" row.
const subagentPeek = 3;
// The room under the last sub-agent's row, before the box or the gate's body.
const agentsFoot = 6;
// The room between the list's strip and its first row.
const agentsHead = 4;

// A running workflow: the tray line shows the current step, the steps open above it.
export type ComposerFlow = {
  name: string;
  steps: { name: string; who: string; gate?: string }[];
  current: number;
};

export type ComposerAdd = "files" | "capture" | "file" | "workflow" | "command";

// Who a note may name, in two groups: the workspace's agents, and the members who reach the
// session (`GET /api/v1/mentionables`).
export type Mentionables = { agents: { id: string; name: string }[]; people: { id: string; name: string }[] };

// The `@word` the caret ends, with where it starts; nothing when the caret is not on one.
export const mentionQuery = (text: string, caret: number): { start: number; query: string } | undefined => {
  const found = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
  return found ? { start: caret - found[1].length - 1, query: found[1] } : undefined;
};

// The groups that match what was typed, agents first; each name once, at most a few of each.
export const mentionMatches = (m: Mentionables, query: string): { group: string; names: string[] }[] => {
  const q = query.toLowerCase();
  const pick = (list: { name: string }[]) => list.map((x) => x.name).filter((n) => n.toLowerCase().includes(q)).slice(0, 6);
  return [
    { group: "Agents", names: pick(m.agents) },
    { group: "People", names: pick(m.people) },
  ].filter((g) => g.names.length > 0);
};

// What a badge in the foot opens when the box starts a session: the agent, the environment, the repositories.
export type ComposerChoice = "agent" | "environment" | "repositories";

export type ComposerBoxProps = {
  mode: ComposerMode;
  onModeChange?: (mode: ComposerMode) => void;
  // Without a draft, the box shows its placeholder and takes no typing.
  draft?: string;
  onDraftChange?: (draft: string) => void;
  badges: ComposerBadges;
  // In a note, `@` offers them: agents, then people.
  mentionables?: Mentionables;
  status?: [string, Tone];
  gate?: ComposerGate;
  flow?: ComposerFlow;
  attachments?: Attachment[];
  // Files the person picked to send with the message ("Attach files", ⌘U): the box opens the system's picker.
  attach?: (files: File[]) => void;
  // Takes an attached file off, by its place in `attachments`.
  detach?: (index: number) => void;
  dragging?: boolean;
  placeholder?: string;
  send?: () => void;
  stop?: () => void;
  add?: (add: ComposerAdd) => void;
  // Opens the list of shortcuts: the info button, last in the foot, always there.
  shortcuts?: () => void;
  // Starts dictation, or stops it while `listening`; Escape stops it too.
  dictate?: () => void;
  // Dictation listens: the mic takes the ink and breathes, and stays beside the send while the words come in.
  listening?: boolean;
  // `scope` "session" also allows the call's tool for the rest of the session.
  decide?: (allow: boolean, scope?: "session") => void;
  answer?: (answer: GateAnswer) => void;
  // With it, the session is archived: the tray says so and offers to bring it back.
  restore?: () => void;
  // With it, the environment serves a preview: the box shows Preview, which shows or hides it in the pane.
  preview?: { shown: boolean; toggle: () => void };
  // The field takes focus when the box appears (a session's view, Home).
  focus?: boolean;
  className?: string;
  // The last turn's sub-agents: a badge on the tray line counts them; it opens their rows under the line.
  subagents?: ComposerSubagent[];
  // How the sub-agents' rows start, for the gallery: closed, the first few, or all.
  subagentsShown?: 0 | 1 | 2;
  // The conversation shown: a sub-agent's id, or none for the main agent's. The tray navigates between them: a
  // sub-agent's row shows its conversation, the main line brings the main one back.
  showing?: string;
  showMain?: () => void;
  // The main agent's facts in the list (time, tools, tokens), as a sub-agent's.
  facts?: string;
  // Bypass: the session runs without approvals while on. Absent, the button is not shown: the person may not turn it
  // on (the API's `access.bypass`) and it is off. `by` names who turned it on.
  bypass?: { on: boolean; by?: string; toggle: () => void };
  // A session to start (Home, the new session dialog): the agent's, the environment's and the repositories' badges
  // open their choice.
  choose?: (choice: ComposerChoice) => void;
  // The box is a dialog (a new session): its header (glyph, title, line, close) where a session's tabs sit.
  head?: ReactNode;
};

// How opaque the veil over an archived session's composer is: the composer stays visible through it.
const archivedVeil = 0.8;

// The room above and below a gate's form, as a part of the room on its sides.
const gateRoomRatio = 0.75;
// The space between every item of a gate's form: the question, each option, your own answer.
const gateGap = 17;
// The room above and below a gate's foot.
const gateFootRoom = 12;

// The side of dictation and the send, on the text's row.
const footSize = 28;
// The quiet row under the divider: its height, and the side of its controls (+, Preview, Note) and badges.
const quietRow = 34;
const quietSize = 24;

// Where a row's mark slot starts.
const slotStart = edgeInset;

// A row's leading mark, centred on the mark axis; the text after it starts on the text edge, the row starting at `slotStart`.
function Lead({ children }: { children: ReactNode }) {
  return (
    <RowMark from={slotStart}>{children}</RowMark>
  );
}

// The session's prompt box. A tray behind its top edge carries the context (agent, branch, tab or workflow), the
// session state and who is here, and a pending approval. The box holds the field and the actions: add, note,
// dictate, send.
export function ComposerBox({
  mode, onModeChange, draft, onDraftChange, badges, mentionables, status, gate, flow, attachments = [], attach, detach, dragging,
  placeholder: given, shortcuts, send = () => {}, stop = () => {}, add: added = () => {}, dictate = () => {}, decide = () => {}, answer = () => {},
  restore, preview, focus, className, subagents = [], subagentsShown = 0, showing, showMain, facts: mainFacts, listening, bypass, choose, head,
}: ComposerBoxProps) {
  const [open, setOpen] = useState(false);
  // "Attach files" opens the system's picker when the page takes files; any other addition goes to the page.
  const picker = useRef<HTMLInputElement>(null);
  const add = (what: ComposerAdd) => (what === "files" && attach ? picker.current?.click() : added(what));
  // The sub-agents' rows: 0 closed, 1 the first few and a "+ more" row, 2 all of them.
  const [agentsOpen, setAgentsOpen] = useState<0 | 1 | 2>(subagentsShown);
  // The first few always stay in the fold, so they leave with it when it closes; the others open in a fold of their own.
  const agentsFirst = subagents.slice(0, subagentPeek);
  const agentsRest = subagents.slice(subagentPeek);
  // The sub-agent whose conversation shows, if one does: the tray's line says so and offers the way back.
  const viewing = subagents.find((a) => a.id === showing);
  const note = mode === "note";
  const asks = !!gate?.questions?.length;
  // Yellow is for approvals only; a question waiting colours the tray blue.
  const gateTone: Tone = asks ? "blue" : "yellow";
  const trayInk = gate ? tone[gateTone].ink : note ? tone.note.ink : palette.secondary;
  const typed = (draft ?? "").trim().length > 0;
  const setMode = (m: ComposerMode) => onModeChange?.(m);
  // The box is open (its tabs shown) while the focus is in it, or while a menu or dialog is showing over it (its +
  // menu, the shortcuts); checked a moment after each focus change, press or key, so a layer opening or closing never
  // closes it in between. Closing takes it back to the agent.
  const boxRef = useRef<HTMLDivElement>(null);
  const [inUse, setInUse] = useState(false);
  const latest = useRef({ note, setMode, onDraftChange });
  latest.current = { note, setMode, onDraftChange };
  useEffect(() => {
    if (!inUse) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A press while a layer shows only dismisses that layer: the box stays, its field focused again.
    // A press inside the box keeps it in use, its field focused: WebKit gives a pressed button no focus.
    let dismissing = false;
    let inside = false;
    const press = (e: PointerEvent) => {
      inside = !!boxRef.current?.contains(e.target as Node);
      dismissing = !!document.querySelector(layers);
    };
    const check = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (boxRef.current?.contains(document.activeElement) || document.querySelector(layers)) return;
        if (dismissing || inside) {
          dismissing = false;
          inside = false;
          boxRef.current?.querySelector("textarea")?.focus({ preventScroll: true });
          return;
        }
        setInUse(false);
        // A note not sent is dropped with it: its words never come back as a message.
        if (latest.current.note) {
          latest.current.onDraftChange?.("");
          latest.current.setMode("message");
        }
      }, boxSettle);
    };
    const events = ["focusin", "focusout", "pointerup", "keyup"] as const;
    for (const e of events) addEventListener(e, check, true);
    addEventListener("pointerdown", press, true);
    return () => {
      clearTimeout(timer);
      for (const e of events) removeEventListener(e, check, true);
      removeEventListener("pointerdown", press, true);
    };
  }, [inUse]);
  const step = flow && flow.steps[flow.current] ? flow.steps[flow.current].name : "";

  const effectiveStatus = ((): [string, Tone] | undefined => {
    if (status) return status;
    if (badges.tab) {
      if (badges.tab.state === "online") return undefined;
      if (badges.tab.state === "offline") return [`${tabStatus.owned(badges.tab)} is offline`, "grey"];
      // The badge says it already.
      return undefined;
    }
    return undefined;
  })();

  // The caller's words when given, else what the mode asks for.
  const placeholder = (() => {
    // Archived, the veil carries the words: the field says nothing under them.
    if (restore) return "";
    if (given && !note) return given;
    if (gate && !gate.decider && !note) return "Answer, or add context before you decide…";
    // A sub-agent's conversation shows: the message goes to it.
    if (viewing && !note) return `Reply to ${viewing.name}…`;
    if (mode === "note") return "Only the team sees it · @ to mention";
    if (mode === "queued") return "Queue a message for after this turn…";
    return flow ? `Reply to the ${step || flow.name} step…` : `Reply to ${badges.agent}…`;
  })();

  // ⌘U, ⌘⇧P, ⌘⇧W add; ⌘⇧N toggles the note; ⌘. stops a queued turn; ⇧Tab in the field toggles Bypass, as in the
  // agents' own terminals.
  const keys = useRef({ add, setMode, mode, stop, typed, bypass });
  keys.current = { add, setMode, mode, stop, typed, bypass };
  useEffect(() => {
    const listen = (e: KeyboardEvent) => {
      if (e.key === "Tab" && e.shiftKey && !e.metaKey && keys.current.bypass && words.current?.contains(document.activeElement)) {
        e.preventDefault();
        keys.current.bypass.toggle();
        return;
      }
      if (!e.metaKey) return;
      const k = e.key.toLowerCase();
      const c = keys.current;
      const hit = (run: () => void) => {
        e.preventDefault();
        run();
      };
      if (k === "u" && !e.shiftKey) hit(() => c.add("files"));
      else if (k === "p" && e.shiftKey) hit(() => c.add("capture"));
      else if (k === "w" && e.shiftKey) hit(() => c.add("workflow"));
      else if (k === "n" && e.shiftKey) hit(() => c.setMode(c.mode === "note" ? "message" : "note"));
      else if (k === "." && c.mode === "queued" && !c.typed) hit(c.stop);
    };
    addEventListener("keydown", listen);
    return () => removeEventListener("keydown", listen);
  }, []);

  // Escape stops dictation, before anything else hears it.
  const stopListening = useRef(dictate);
  stopListening.current = dictate;
  useEffect(() => {
    if (!listening) return;
    const listen = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      stopListening.current();
    };
    addEventListener("keydown", listen, true);
    return () => removeEventListener("keydown", listen, true);
  }, [listening]);

  // Only the workflow chip opens something; the agent and the branch are names, with no chevron.
  const chevron = <Glyph name="chevronDown" size={8} color={trayInk} />;

  // The main agent stays on top; each sub-agent is a row under it, in the line's style. The rows open and close in a
  // fold: the first few, then "+ more", which opens the others in a fold of its own. The last row keeps some room under it.
  const agentRow = (a: ComposerSubagent) => <SubagentLine key={a.id} agent={a} ink={trayInk} on={showing === a.id} />;
  const listed = subagents.length > 0;
  const listOpen = listed && agentsOpen > 0;
  const agentsBadge = (
          <Clickable fill={alpha(trayInk, 0.08)} onClick={() => setAgentsOpen(agentsOpen === 0 ? 1 : 0)} label="Sub-agents" handle="button:Sub-agents" className="flex h-6 shrink-0 items-center gap-1.5 px-1.5">
              {subagents.some((a) => a.state === "running") ? <Spinner size={11} color={trayInk} /> : <Glyph name="bot" size={11} color={trayInk} />}
              <span className="text-[13px] whitespace-nowrap" style={{ color: trayInk }}>
                {subagents.length === 1 ? "1 sub-agent" : `${subagents.length} sub-agents`}
              </span>
              <Turn open={agentsOpen > 0} by={180}>
                {chevron}
              </Turn>
            </Clickable>
  );
  // The main agent as the list's first row: chosen unless a sub-agent shows; the badge on its right closes the list.
  const mainRow = (
    // The main agent's row: chosen unless a sub-agent's conversation shows.
    <TrayRow chosen={!viewing} ink={trayInk} onClick={showMain} label={badges.agent} handle={`row:${badges.agent}`}>
      <RowMark from={fillGap} gap={8}>
        <Glyph name="agent" size={11} color={trayInk} />
      </RowMark>
      <span className={cn("shrink-0 text-[13px] whitespace-nowrap", !viewing && "font-medium text-ink")} style={viewing ? { color: trayInk } : undefined}>
        {badges.agent}
      </span>
      <span className={cn("min-w-0 flex-1 truncate text-tertiary", badges.tab ? "text-[13px]" : "font-mono text-[12px]")}>
        {badges.tab ? (badges.tab.state === "none" ? "No tab" : tabStatus.owned(badges.tab)) : badges.branch}
      </span>
      {mainFacts && <span className="shrink-0 font-mono text-[12px] text-tertiary">{mainFacts}</span>}
    </TrayRow>
  );
  // Closing the list goes back to the main conversation.
  const closeList = () => {
    setAgentsOpen(0);
    showMain?.();
  };
  // Opened, the list takes the line's place under a strip, "All activity", whose x closes it and brings the main
  // conversation back: one list of conversations, the main agent first, the one shown chosen.
  const agentRows = listed && (
    <div>
    <Accordion open={listOpen}>
      <ToneStrip
        tone={gate ? gateTone : "grey"}
        fill="transparent"
        style={{ boxShadow: `inset 0 1px 0 ${alpha(palette.ink, 0.06)}, inset 0 -1px 0 ${alpha(palette.ink, 0.06)}` }}
        glyph="bot"
        label="All activity"
        action={
          // Only the glyph, as a row's chevron: its own white taken back so its stroke ends on the inset; the hover fill
          // reaches round it.
          <Clickable fill={alpha(trayInk, 0.08)} bleed={4} onClick={closeList} label="Close, back to the main conversation" handle="button:Close activity" className={cn(glyphTrim, "flex h-5 items-center")}>
            <Glyph name="close" size={12} color={palette.tertiary} />
          </Clickable>
        }
      />
      <div className="flex flex-col items-stretch" style={{ paddingTop: agentsHead, paddingBottom: agentsFoot }}>
        {mainRow}
        {agentsFirst.map(agentRow)}
        {agentsRest.length > 0 && (
          <>
            <Accordion open={agentsOpen === 2}>
              <div className="flex flex-col items-stretch">{agentsRest.map(agentRow)}</div>
            </Accordion>
            <Accordion open={agentsOpen !== 2}>
              <Clickable fill={alpha(trayInk, 0.06)} onClick={() => setAgentsOpen(2)} label={`${agentsRest.length} more sub-agents`} handle="button:More sub-agents" className="flex h-[30px] items-center" style={fillInset}>
                <RowMark from={fillGap}>
                  <Glyph name="plus" size={11} color={trayInk} />
                </RowMark>
                <span className="text-[13px]" style={{ color: trayInk }}>
                  {agentsRest.length} more
                </span>
              </Clickable>
            </Accordion>
          </>
        )}
      </div>
    </Accordion>
    </div>
  );

  const hairline = note ? alpha(tone.note.ink, 0.28) : alpha(palette.ink, 0.1);
  const fieldInk = note ? tone.note.ink : ink;
  const promptInk = note ? alpha(tone.note.ink, 0.62) : palette.tertiary;
  const actionInk = note ? tone.note.ink : palette.secondary;

  // The words' height: past one line, the row's controls move under them; back to one row once the words are cleared,
  // so the layout never flips at the wrapping point.
  const words = useRef<HTMLDivElement>(null);
  const [tall, setTall] = useState(false);
  useLayoutEffect(() => {
    const el = words.current;
    if (!el) return;
    if (!typed) {
      setTall(false);
      return;
    }
    const measure = () => {
      if (el.offsetHeight > footSize + 4) setTall(true);
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [typed]);

  // The box's buttons: filled (dictation, an empty send), a step darker on hover; in a note, the note's tone.
  const footFill = note ? tone.note.fill : palette.area;
  const info = shortcuts && (
    <Clickable fill={footFill} radius={6} onClick={shortcuts} label="Shortcuts" handle="button:Shortcuts" className="flex items-center justify-center" style={{ width: quietSize, height: quietSize }}>
      <Glyph name="info" size={13} color={actionInk} />
    </Clickable>
  );

  const box = (
    // A press anywhere on the box that is not one of its controls puts the cursor in the field. The focus leaving the
    // box (not for one of its menus) takes it back to the agent: a note is written only while the box is in use.
    <div
      ref={boxRef}
      onFocus={() => setInUse(true)}
      onMouseDown={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest(composerControls)) return;
        const field = e.currentTarget.querySelector("textarea");
        if (!field) return;
        e.preventDefault();
        field.focus({ preventScroll: true });
      }}
      className={cn(
        "group/box relative",
        // As a dialog, the dialog's face: its corners and its floating shadow.
        head ? "rounded-[12px]" : "rounded-panel shadow-composer",
        note ? "bg-note-wash" : "bg-page",
      )}
    >
      {attach && (
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          data-testid="input:Attach files"
          onChange={(e) => {
            const files = [...(e.currentTarget.files ?? [])];
            e.currentTarget.value = "";
            if (files.length) attach(files);
          }}
        />
      )}
      <div className={cn("flex flex-col items-stretch", dragging && "opacity-45")}>
        {/* Where the words go, Message or Note, as tabs at the top: hidden at rest, they rise into the box while it is
            focused and leave with the focus; the shortcuts sit at the row's right end. */}
        {onModeChange && (
          <div
            className={cn(
              "grid transition-[grid-template-rows,opacity,translate] duration-[160ms] ease-out",
              inUse ? "grid-rows-[1fr] opacity-100" : "translate-y-1 grid-rows-[0fr] opacity-0",
            )}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="flex h-9 items-stretch" style={{ paddingLeft: textEdge - 12, paddingRight: edgeInset }}>
                <PageTabs items={["Message", "Note"]} selection={note ? 1 : 0} onChange={(i) => setMode(i ? "note" : "message")} />
                <span className="flex-1" />
                {shortcuts && (
                  <span className="flex items-center">
                    <IconButton glyph="info" label="Shortcuts" fill={footFill} color={actionInk} size={footSize} onClick={shortcuts} />
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
        {head}
        {attachments.length > 0 && (
          <div className="flex gap-2.5" style={{ paddingLeft: textEdge, paddingTop: edgeInset }}>
            {attachments.map((a, i) => (
              <AttachmentSquare key={`${i} ${a.name}`} file={a} remove={detach ? () => detach(i) : undefined} />
            ))}
          </div>
        )}
        {/* The text's row: + in the mark column, the words on the text edge, dictation and the send on the same row,
            `edgeInset` from the box's top, right and bottom. Once the words take a second line they take the whole width,
            and +, the switch and the buttons move to a row under them; it comes back to one row when the words are cleared. */}
        <div className="flex flex-wrap items-end gap-x-1.5" style={{ padding: edgeInset, paddingLeft: textEdge, rowGap: tall ? edgeInset : 0 }}>
          <div ref={words} className="flex min-w-0 flex-1 items-center text-[15px]" style={tall ? { order: -1, flexBasis: "100%", minHeight: footSize } : { minHeight: footSize }}>
            {draft !== undefined ? (
              <ComposerField focus={focus} value={draft} onChange={(v) => onDraftChange?.(v)} placeholder={placeholder} ink={fieldInk} promptInk={promptInk} submit={send} mentionables={note ? mentionables : undefined} />
            ) : (
              <span className="truncate leading-[20px]" style={{ color: promptInk }}>
                {placeholder}
              </span>
            )}
          </div>
          {/* Empty, only dictation; the first key typed swaps it for the send. While dictation listens, its mic stays
              before the send to stop it. The agent is stopped from the working line. */}
          {tall && <span className="flex-1" />}
          {listening && (
            <span className="listening" style={{ "--listening-ink": alpha(fieldInk, 0.28) } as CSSProperties}>
              <IconButton glyph="mic" label="Stop dictation" fill={fieldInk} color={palette.onSolid} size={footSize} onClick={dictate} />
            </span>
          )}
          {typed ? (
            <IconButton glyph="arrowUp" label={mode === "queued" && !viewing ? "Queue" : "Send"} fill={fieldInk} color={palette.onSolid} size={footSize} onClick={send} />
          ) : (
            !listening && <IconButton glyph="mic" label="Dictate" fill={footFill} color={actionInk} size={footSize} onClick={dictate} />
          )}

        </div>
        {flow && open && !note && <FlowSteps flow={flow} ink={trayInk} />}
        {agentRows}
        {/* A divider inside the box, edge to edge, then a quiet row: what the session runs on (model, repository,
            environment, or the tab it acts in) from the text edge, and Preview on the right. */}
        <div className="h-px" style={{ background: note ? alpha(tone.note.ink, 0.12) : alpha(palette.ink, 0.06) }} />
        {/* Narrow (the composer beside a preview), the badges leave whole, the least needed first: the environment, the
            repository, the model; the agent stays. A badge is never cut to a letter. */}
        <div className={cn("@container flex items-center overflow-hidden", head ? "rounded-b-[12px]" : "rounded-b-panel")} style={{ height: quietRow, paddingRight: edgeInset }}>
          {/* + first in the foot: a square cell the foot's full height, the glyph in its centre, the whole cell filled
              while hovered, a line after it. */}
          <span className="flex shrink-0 self-stretch">
            <Dropdown
              above
              width={300}
              fill="transparent"
              entries={[
                menu.item("Attach files", { glyph: "clip", keys: ["⌘", "U"], action: () => add("files") }),
                menu.item("Capture the preview", { glyph: "capture", keys: ["⌘", "⇧", "P"], action: () => add("capture") }),
                menu.item("A file from the repo", { glyph: "file", keys: ["@"], action: () => add("file") }),
                menu.divider,
                menu.item("A workflow", { glyph: "workflow", keys: ["⌘", "⇧", "W"], action: () => add("workflow") }),
                menu.item("A command", { glyph: "command", keys: ["/"], action: () => add("command") }),
              ]}
              label={() => (
                <span aria-label="Add to the message" data-testid="button:Add to the message" className="flex items-center justify-center transition-colors duration-[120ms] hover:bg-(--cell)" style={{ width: quietRow, height: quietRow, ["--cell" as string]: footFill }}>
                  <Glyph name="plus" size={13} color={actionInk} width={1.6} />
                </span>
              )}
            />
            <Rule vertical />
          </span>
          <FootBadge glyph="agent" text={badges.agent} ink={actionInk} fill={footFill} open={choose && (() => choose("agent"))} />
          {badges.model && <FootBadge glyph="sparkle" text={badges.model} ink={actionInk} fill={footFill} narrow="@max-[380px]:hidden" divided />}
          {/* Starting a session, the environment comes before its repositories, and both show even when unset: they are
              the way to choose them. */}
          {choose ? (
            <>
              <FootBadge glyph="server" text={badges.environment || "No environment"} ink={actionInk} fill={footFill} divided open={() => choose("environment")} />
              <FootBadge glyph="repo" text={badges.repos.join(", ") || "No repository"} ink={actionInk} fill={footFill} divided open={() => choose("repositories")} />
            </>
          ) : (
            <>
              {badges.repos.length > 0 && <FootBadge glyph="repo" text={badges.repos.join(", ")} ink={actionInk} fill={footFill} narrow="@max-[480px]:hidden" divided />}
              {badges.environment && <FootBadge glyph="server" text={badges.environment} ink={actionInk} fill={footFill} narrow="@max-[560px]:hidden" divided />}
            </>
          )}
          {badges.tab && <FootBadge glyph="globe" text={badges.tab.state === "none" ? "No tab" : tabStatus.owned(badges.tab)} ink={actionInk} fill={footFill} narrow="@max-[480px]:hidden" divided />}
          {flow && !note && (
            <Clickable fill={alpha(trayInk, 0.08)} onClick={() => setOpen(!open)} label={flow.name} handle={`button:${flow.name}`} className="flex h-6 min-w-0 items-center gap-1.5 px-1.5">
              <FlowRing ink={trayInk} share={(flow.current + 1) / Math.max(flow.steps.length, 1)} />
              <span className="truncate text-[13px]">{flow.name}</span>
              <span className="font-mono text-[12px]">
                {flow.current + 1}/{flow.steps.length}
              </span>
              <span className="truncate text-[13px]">{step}</span>
              <Turn open={open} by={180}>
                {chevron}
              </Turn>
            </Clickable>
          )}
          <span className="min-w-2 flex-1" />
          <div className="flex shrink-0 items-center gap-2">
            {note ? null : effectiveStatus ? (
          <span className="flex items-center gap-1.5">
            {!gate && <Dot tone={effectiveStatus[1]} />}
            <span className="text-[13px] whitespace-nowrap" style={{ color: trayInk }}>
              {effectiveStatus[0]}
            </span>
          </span>
        ) : null}
            {subagents.length > 0 && agentsBadge}
            {/* Bypass, last on the right: a control, so it never leaves on a narrow box; quiet while off, on the warning's
                face while on. */}
            {bypass && (
              <Tooltip text={bypass.on ? `On${bypass.by ? ` by ${bypass.by}` : ""}: calls run without approvals · ⇧Tab` : "Run without approvals · ⇧Tab"}>
                <span className="ml-1 flex shrink-0 items-center rounded-[6px] px-2" style={{ height: quietSize, background: bypass.on ? tone.orange.fill : undefined }}>
                  <Toggle small label="Bypass" tone="orange" on={bypass.on} onChange={bypass.toggle} />
                </span>
              </Tooltip>
            )}
          </div>
          {preview && (
            <Clickable fill={footFill} radius={6} active={preview.shown} onClick={preview.toggle} label="Preview" handle="button:Preview" chosen={preview.shown} className="flex items-center gap-1.5 px-1.5" style={{ height: quietSize }}>
              <Glyph name="preview" size={12} color={actionInk} />
              <span className="text-[12.5px]" style={{ color: actionInk }}>
                Preview
              </span>
            </Clickable>
          )}
          {shortcuts && !onModeChange && info}
        </div>
      </div>
      {dragging ? (
        <>
          <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
            <rect x="0" y="0" width="100%" height="100%" rx="10" fill="none" stroke={alpha(ink, 0.4)} strokeWidth="1" strokeDasharray="5 4" />
          </svg>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2">
            <Glyph name="clip" size={14} color={ink} width={1.4} />
            <span className="text-[14px] text-ink">Drop to attach</span>
          </div>
        </>
      ) : head ? null : (
        // Focused, the edge darkens and a soft halo rings the box: quieter than a field's focus. Both colours are
        // classes, so the focus one wins over the resting one.
        <span
          className={cn(
            "pointer-events-none absolute inset-0 rounded-panel transition-[outline-color,box-shadow] duration-[120ms] ease-out",
            "[outline:1px_solid_var(--rest)] group-focus-within/box:[outline-color:var(--focus)] group-focus-within/box:shadow-[0_0_0_4px_var(--halo)]",
          )}
          style={{
            outlineOffset: -0.5,
            ["--rest" as string]: hairline,
            ["--focus" as string]: alpha(note ? tone.note.ink : palette.ink, note ? composerFocusEdgeNote : composerFocusEdge),
            ["--halo" as string]: alpha(note ? tone.note.ink : palette.ink, composerHalo),
          }}
        />
      )}
    </div>
  );

  // An approval yours to decide answers Enter (Allow) and Escape (Deny); a question takes its own keys.
  const deciding = !!gate && !note && !asks && !gate.decider;
  useGateKeys(deciding ? () => decide(true) : undefined, deciding ? () => decide(false) : undefined);

  // With a gate, the composer is a GatePanel: its strip, then the decision or the form.
  const gatePanel =
    gate && !note ? (
      <GatePanel tone={gateTone}>
        {asks ? (
          <QuestionGate key={gate.questions!.map((q) => q.question).join("|")} questions={gate.questions!} detail={gate.detail} asked={gate.asked} dismiss={() => decide(false)} send={answer} />
        ) : (
          <OnTone.Provider value="yellow">
            <div data-testid={`approval:${gate.title}`} className="relative flex flex-col items-stretch" style={{ color: tone.yellow.ink }}>
              <ToneStrip tone="yellow" fill="transparent" label={<GateLabel text={gate.decider ? "Needs approval" : "Needs your approval"} asked={gate.asked} />} detail={gate.detail} glyph="gate" />
              <div className="flex items-center" style={{ paddingInline: textEdge, paddingBlock: textEdge * gateRoomRatio }}>
                <span className="line-clamp-2 text-[15px] leading-5 font-semibold tracking-[-0.17px] text-ink">{gate.title}</span>
              </div>
              <GateFoot tone="yellow" end={edgeInset} keys={{ confirm: gate.allowable ? "Allow once" : "Allow", refuse: "Deny", then: "to continue" }} waiting={gate.decider}>
                {/* As a question's foot: the refusal in plain words, the actions filled and last; Allow for this session,
                    when the tool may be allowed for the session, last of all. While someone else decides they all stay,
                    disabled: the filled ones on their disabled face, Deny dimmed and still plain words. */}
                <Button kind="quiet" size="small" disabled={!!gate.decider} onClick={() => decide(false)}>
                  Deny
                </Button>
                <Button kind="primary" size="small" disabled={!!gate.decider} onClick={() => decide(true)}>
                  {gate.allowable ? "Allow once" : "Allow"}
                </Button>
                {gate.allowable && (
                  <Button kind="primary" size="small" disabled={!!gate.decider} onClick={() => decide(true, "session")}>
                    Allow for this session
                  </Button>
                )}
              </GateFoot>
            </div>
          </OnTone.Provider>
        )}
      </GatePanel>
    ) : undefined;

  return (
    <div className={cn("relative flex w-full flex-col items-stretch", className)} data-testid="group:Composer">
      {gatePanel ?? box}
      {restore && (
        // Archived: a veil over the whole composer, the composer seen through it, what happened and Restore on top.
        <div
          className="absolute inset-0 z-20 flex items-center justify-center gap-3 rounded-t-block rounded-b-panel backdrop-blur-[3px]"
          style={{ background: alpha(palette.page, archivedVeil), paddingInline: textEdge }}
        >
          <span className="text-[13px] text-secondary">This session is archived. It no longer shows in Sessions.</span>
          <Button size="small" onClick={restore}>
            Restore
          </Button>
        </div>
      )}
    </div>
  );
}

// A gate's keys while it shows: Enter confirms (Allow, Continue, Next) and Escape refuses (Deny, Dismiss). They are
// caught before anything else on the page, so while a gate shows Enter does nothing but confirm. Neither acts while the
// person types in a field, nor while a dialog, drawer or menu is open: that layer keeps its keys.
function useGateKeys(confirm: (() => void) | undefined, refuse: (() => void) | undefined) {
  const latest = useRef({ confirm, refuse });
  latest.current = { confirm, refuse };
  useEffect(() => {
    const press = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      // An open dialog, drawer or menu owns the keys: Escape closes it, never the gate.
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const act = e.key === "Enter" ? latest.current.confirm : e.key === "Escape" ? latest.current.refuse : undefined;
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();
      act();
    };
    addEventListener("keydown", press, { capture: true });
    return () => removeEventListener("keydown", press, { capture: true });
  }, []);
}

// A gate's foot: under a line in its tone, the decision or the form's buttons on the right, with a little more room
// above and below than the header. Its right end (`end`): an approval's under the header's detail (`edgeInset`), a
// question's as far in as its form (`textEdge`). On the gate's own ground: an approval's yellow, a question's white
// (`fill`).
// `keys`: on the left from the text edge, in the gate's ink, a phrase with the keys in it: "↵ Allow or esc Deny to
// continue" (`useGateKeys`).
// `waiting`: someone else decides; the phrase says who, after a clock, and the buttons stay, disabled.
function GateFoot({ tone: t, fill, end, keys, waiting, children }: { tone: Tone; fill?: string; end: number; keys?: { confirm: string; refuse: string; then?: string }; waiting?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3" style={{ paddingLeft: textEdge, paddingRight: end, paddingBlock: gateFootRoom, background: fill ?? tone[t].fill, boxShadow: `inset 0 1px 0 ${alpha(tone[t].ink, toneEdge)}` }}>
      {waiting && (
        <span className={cn(monoCaps, "flex min-w-0 items-center gap-1.5 whitespace-nowrap")} style={{ color: alpha(tone[t].ink, 0.75) }}>
          <Glyph name="clock" size={12} color={tone[t].ink} />
          <span className="truncate">Waiting on {waiting}</span>
        </span>
      )}
      {keys && !waiting && (
        // In the header's voice: mono, uppercase, the keys tinted in the gate's tone.
        // It gives way to the buttons: it adds nothing to the gate's least width, and on a narrow gate it is cut,
        // never the buttons.
        <span className={cn(monoCaps, "flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap contain-inline-size")} style={{ color: alpha(tone[t].ink, 0.75) }}>
          <Kbd k="↵" tone={t} />
          <span>{keys.confirm} or</span>
          <Kbd k="esc" tone={t} />
          <span className="truncate">
            {keys.refuse}
            {keys.then && ` ${keys.then}`}
          </span>
        </span>
      )}
      {/* The hint takes the free room itself; without it, this does. */}
      {(!keys || waiting) && <span className="min-w-3 flex-1" />}
      {children}
    </div>
  );
}

// The composer while a call waits on a person: one panel in the gate's tone, its strip, then the decision or the form.
// Its edge is drawn over its rows.
export function GatePanel({ tone: t, children }: { tone: Tone; children: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-panel shadow-composer" style={{ background: t === "yellow" ? tone.yellow.fill : palette.page }}>
      <span aria-hidden className="pointer-events-none absolute inset-0 z-10 rounded-panel" style={edge(alpha(tone[t].ink, 0.16))} />
      {children}
    </div>
  );
}

// A badge in the quiet row: what the session runs on, shown, not chosen: a glyph and a word, no face; its glyph
// starts the badge, so the first one stands on the text edge.
// `narrow`: the foot's width under which it leaves (a container query on the foot).
// One cell of the foot, its whole height: a line before it when `divided`, the full height too, with no gap, and the
// whole cell filled while hovered. It leaves with its line on a narrow box. With `open`, it is a control: a press
// opens its choice, and it stays on a narrow box, cut rather than gone.
function FootBadge({ glyph, text, ink: color, fill, narrow, divided, open }: { glyph: string; text: string; ink: string; fill: string; narrow?: string; divided?: boolean; open?: () => void }) {
  const face = (
    <>
      <Glyph name={glyph} size={12} color={color} />
      <span className="truncate text-[12.5px]" style={{ color }}>
        {text}
      </span>
    </>
  );
  return (
    <span className={cn("flex min-w-0 self-stretch", open ? "shrink" : cn("shrink-0", narrow))}>
      {divided && <Rule vertical />}
      {open ? (
        <Clickable fill={fill} radius={0} onClick={open} label={text} handle={`badge:${text}`} className="flex min-w-0 items-center gap-1.5 px-3">
          {face}
        </Clickable>
      ) : (
        <span data-testid={`badge:${text}`} className="flex min-w-0 items-center gap-1.5 px-3 transition-colors duration-[120ms] hover:bg-(--cell)" style={{ ["--cell" as string]: fill }}>
          {face}
        </span>
      )}
    </span>
  );
}

// A tray row's fill (its hover, its chosen face) sits `fillGap` inside the tray on both sides, as a card row's does;
// its content stays on the grid: the mark through RowMark, the right end `edgeInset` in (the tray pads its right).
const fillGap = 4;
// 1 above and below, so two faces side by side (a hover beside the chosen one) never touch and read the same height.
const fillInset: CSSProperties = { marginInline: fillGap, marginBlock: 1, paddingRight: edgeInset - fillGap };
// The chosen row's face, as a chosen segment's: white on its edge.
// What in the composer acts on a press of its own; a press elsewhere on the box goes to the field.
const composerControls = "button, a, input, textarea, select, [role=button], [role=switch], [role=menuitem], [role=option], [tabindex]";

// The composer focused: its edge's share of the ink (of the note's ink in a note), and its halo's.
const composerFocusEdge = 0.22;
const composerFocusEdgeNote = 0.45;
// How long after a focus change, press or key the box checks whether it is still in use.
const boxSettle = 60;
// What shows over the composer: a menu, a list (mentions), a dialog (the shortcuts).
const layers = '[role="menu"], [role="listbox"], [role="dialog"]';
const composerHalo = 0.04;

const chosenFace: CSSProperties = { background: palette.page, ...edge(palette.cardEdge) };

// A sub-agent's state as a mark: turning while it runs, a red cross when it failed, a green check when done.
function subagentMark(agent: ComposerSubagent, ink: string) {
  return agent.state === "running" ? <Spinner size={11} color={ink} /> : agent.state === "failed" ? <Glyph name="close" size={11} color={tone.red.ink} /> : <Glyph name="check" size={11} color={tone.green.ink} />;
}

// One sub-agent under the tray's line: its state as the mark, its name, its last line, its facts ending the row; a
// click shows its conversation in the main one's place. The one showing (`on`) is chosen, as a segment is: a white face
// on its edge, its name in ink, and no click.
function SubagentLine({ agent, ink: lineInk, on }: { agent: ComposerSubagent; ink: string; on?: boolean }) {
  return (
    <TrayRow chosen={on} ink={lineInk} onClick={agent.open} label={agent.name} handle={`subagent:${agent.name}`}>
      <RowMark from={fillGap} gap={8}>{subagentMark(agent, lineInk)}</RowMark>
      <span className={cn("shrink-0 text-[13px] whitespace-nowrap", on && "font-medium text-ink")} style={on ? undefined : { color: lineInk }}>
        {agent.name}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-tertiary">{agent.line}</span>
      {agent.facts && <span className="shrink-0 font-mono text-[12px] text-tertiary">{agent.facts}</span>}
    </TrayRow>
  );
}

// A row of the tray's list. Chosen, it is the conversation shown: a white face that stays white, no hover, no press,
// no focus. Otherwise a click shows its conversation.
function TrayRow({ chosen, ink, onClick, label, handle, children }: { chosen?: boolean; ink: string; onClick?: () => void; label: string; handle: string; children: ReactNode }) {
  const row = "flex h-[30px] min-w-0 items-center gap-2";
  return chosen ? (
    <div aria-selected data-testid={handle} className={cn(row, "rounded-[5px]")} style={{ ...fillInset, ...chosenFace }}>
      {children}
    </div>
  ) : (
    <Clickable fill={alpha(ink, 0.06)} onClick={onClick} label={label} handle={handle} className={row} style={fillInset}>
      {children}
    </Clickable>
  );
}

// The share of a workflow done, as a ring.
function FlowRing({ ink: color, share }: { ink: string; share: number }) {
  const r = 5;
  const c = 2 * Math.PI * r;
  return (
    <svg width={12} height={12} className="shrink-0 -rotate-90">
      <circle cx={6} cy={6} r={r} fill="none" stroke={alpha(color, 0.18)} strokeWidth={2} />
      <circle cx={6} cy={6} r={r} fill="none" stroke={tone.blue.dot} strokeWidth={2} strokeLinecap="round" strokeDasharray={`${c * share} ${c}`} />
    </svg>
  );
}

function FlowSteps({ flow, ink: trayInk }: { flow: ComposerFlow; ink: string }) {
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = Math.max(flow.current - 2, 0) * 32;
  }, [flow.current]);
  return (
    <div className="pt-1 animate-in fade-in-0 slide-in-from-bottom-1.5 duration-200">
      <div ref={list} className="overflow-y-auto" style={{ maxHeight: Math.min(flow.steps.length * 32, 196) }}>
        {flow.steps.map((s, i) => {
          const now = i === flow.current;
          const done = i < flow.current;
          return (
            <div key={i} className="relative flex h-8 items-center" style={{ paddingLeft: slotStart }}>
              <Lead>
                {/* A step's number fits the slot with a point to spare on each side. */}
                <span
                  className="flex shrink-0 items-center justify-center rounded-full font-mono text-[10px]"
                  style={{
                    width: markSlot - 2,
                    height: markSlot - 2,
                    color: now ? palette.onSolid : trayInk,
                    background: done ? palette.pressed : now ? tone.blue.dot : "transparent",
                    boxShadow: i > flow.current ? `inset 0 0 0 1px ${alpha(trayInk, 0.3)}` : undefined,
                  }}
                >
                  {i + 1}
                </span>
              </Lead>
              <span className="flex min-w-0 items-center gap-2.5">
                <span className={cn("text-[13px] whitespace-nowrap", now && "font-medium")} style={{ color: i > flow.current ? trayInk : ink }}>
                  {s.name}
                </span>
                <span className="truncate text-[12.5px] text-tertiary">{s.who}</span>
              </span>
              <span className="min-w-2 flex-1" />
              <span className="font-mono text-[12px]" style={{ color: now ? tone.blue.ink : palette.tertiary }}>
                {done ? "✓" : now ? "running" : s.gate ?? ""}
              </span>
              <span className="pointer-events-none absolute bottom-0 left-0 h-px bg-ink/6" style={{ right: -edgeInset }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The composer's field: grows from one line to twelve; Return sends, Shift-Return breaks the line.
function ComposerField({ value, onChange, placeholder, ink: color, promptInk, submit, focus, mentionables }: {
  value: string; onChange: (v: string) => void; placeholder: string; ink: string; promptInk: string; submit: () => void; focus?: boolean; mentionables?: Mentionables;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(value.length);
  const [active, setActive] = useState(0);
  // Closed by Esc or by leaving the field, until the words change again.
  const [closed, setClosed] = useState(false);
  const [anchor, setAnchor] = useState<HTMLTextAreaElement | null>(null);
  // Takes the keys when its page opens: the cursor waits in the field.
  // Focused on arrival (a reload, a restored draft): the cursor after the last character.
  useEffect(() => {
    const el = ref.current;
    if (!focus || !el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [focus]);
  // A draft restored after the focus (read from storage a moment later) moves the cursor after it too, until the
  // person types.
  const typedHere = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (typedHere.current || !el || document.activeElement !== el) return;
    el.setSelectionRange(el.value.length, el.value.length);
  }, [value]);
  useEffect(() => setAnchor(ref.current), []);
  // Its height follows its lines, measured again when the words change and when its width does (the box moves its
  // buttons under the words once they pass a line).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let width = el.clientWidth;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 12 * 20)}px`;
    };
    fit();
    const watch = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, [value]);
  const word = mentionables ? mentionQuery(value, caret) : undefined;
  const groups = mentionables && word ? mentionMatches(mentionables, word.query) : [];
  const names = groups.flatMap((g) => g.names);
  const open = !closed && names.length > 0;
  const pick = (name: string) => {
    if (!word) return;
    const next = `${value.slice(0, word.start)}@${name} ${value.slice(caret)}`;
    const at = word.start + name.length + 2;
    onChange(next);
    setCaret(at);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(at, at);
    });
  };
  let n = -1;
  const entries: MenuEntry[] = groups.flatMap((g) => [
    menu.title(g.group),
    ...g.names.map((name): MenuEntry => {
      const index = (n += 1);
      return menu.item(name, { radio: true, checked: index === active, action: () => pick(name) });
    }),
  ]);
  return (
    <>
      <textarea
        {...plainText}
        ref={ref}
        rows={1}
        value={value}
        aria-label={placeholder}
        data-testid="input:Composer"
        placeholder={placeholder}
        onChange={(e) => {
          typedHere.current = true;
          onChange(e.target.value);
          setCaret(e.target.selectionStart);
          setActive(0);
          setClosed(false);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onBlur={() => setClosed(true)}
        onKeyDown={(e) => {
          if (open && !e.nativeEvent.isComposing) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a + (e.key === "ArrowDown" ? 1 : names.length - 1)) % names.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(names[Math.min(active, names.length - 1)]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setClosed(true);
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        className="min-w-0 flex-1 resize-none bg-transparent p-0 text-[15px] leading-[20px] outline-none placeholder:text-(--prompt)"
        style={{ color, "--prompt": promptInk } as CSSProperties}
      />
      {open && <AnchoredMenu anchor={anchor} entries={entries} close={() => setClosed(true)} />}
    </>
  );
}

// Questions in the tray, one at a time: where the steps stand, the question and its options, a field for the
// person's own words; on the right Dismiss, Back and Next, and Continue on the last. Next and Continue wait for a pick or words.
export function QuestionGate({ questions, detail = "", asked, dismiss, send }: { questions: GateQuestion[]; detail?: string; asked?: string; dismiss: () => void; send: (answer: GateAnswer) => void }) {
  const [step, setStep] = useState(0);
  const [picks, setPicks] = useState<Record<number, Set<number>>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const answer = GateAnswer.of(questions, picks, notes);
  const answered = answer.picks[step] !== undefined || answer.notes[step] !== undefined;
  const last = step === questions.length - 1;
  const complete = GateAnswer.complete(answer, questions.length);
  const q = questions[step];
  // Enter goes on (Next, or Continue once complete), Escape dismisses.
  useGateKeys(last ? (complete ? () => send(answer) : undefined) : answered ? () => setStep(step + 1) : undefined, dismiss);
  // Where you are among several questions; the agent's short title for each (`header`) only repeats the question.
  const where = [questions.length > 1 ? `${step + 1} of ${questions.length}` : undefined, detail || undefined].filter((s) => s).join(" · ");
  return (
    <div data-testid={`question:${q.question}`} className="relative flex flex-col items-stretch">
      {/* A thin header in the tray's blue: the label on the text edge, where the question stands and a question glyph on the right. */}
      <ToneStrip tone="blue" label={<GateLabel text="Needs your answer" asked={asked} />} detail={where} glyph="question" />
      {/* The form on white, edge to edge under a line, in its own colours: no form is written on a colour. */}
      <OnTone.Provider value={undefined}>
      <div className="flex flex-col items-stretch bg-page" style={{ paddingInline: textEdge, paddingBlock: textEdge * gateRoomRatio, gap: gateGap }}>
        <QuestionBody
          key={step}
          question={q}
          picks={picks[step] ?? new Set()}
          onPicks={(s) => setPicks({ ...picks, [step]: s })}
          note={{ value: notes[step] ?? "", onChange: (v) => setNotes({ ...notes, [step]: v }) }}
          keys={false}
          fill={palette.quiet}
          marks="card"
        />
      </div>
      </OnTone.Provider>
      <OnTone.Provider value={undefined}>
        <GateFoot tone="blue" fill={palette.page} end={textEdge} keys={{ confirm: last ? "Continue" : "Next", refuse: "Dismiss" }}>
          {/* Dismiss is plain words, just left of the action: the answer is the action. */}
          <Button kind="quiet" size="small" onClick={dismiss}>
            Dismiss
          </Button>
          {questions.length > 1 && (
            <Button kind="ghost" size="small" disabled={step === 0} onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          {last ? (
            <Button kind="primary" size="small" disabled={!complete} onClick={() => send(answer)}>
              Continue
            </Button>
          ) : (
            <Button kind="primary" size="small" disabled={!answered} onClick={() => setStep(step + 1)}>
              Next
            </Button>
          )}
        </GateFoot>
      </OnTone.Provider>
    </div>
  );
}

