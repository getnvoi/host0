import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Accordion } from "./accordion";
import { useDelayedBusy } from "./busy";
import { cn } from "./cn";
import { codeTheme, codeType, Highlighted } from "./code";
import { Clickable } from "./clickable";
import { conversationTable } from "./conversationtable";
import { useDark } from "./dark";
import { Face } from "./faces";
import { useFloat } from "./floating";
import { Glyph, glyphTrim, Turn } from "./glyph";
import { TextInput } from "./inputs";
import { FileTiles, type FileView } from "./media";
import { Tooltip } from "./menu";
import { usePresence } from "./presence";
import {
  alpha, Avatar, Button, Checkbox, Chip, Choice, ChoiceField, Dot, edge, GroupTitle, IconButton, Kbd, LeadView, LoadingState, monoCaps, OnTone, Pill, Radio, RowMark, Rule, Skeleton, Spinner, ToneStrip,
} from "./primitives";
import { edgeInset, markAxis, markSlot, measure, palette, textEdge, toneEdge, tone as tones, type Tone } from "./tokens";
import { CardRule } from "./cards";
import { AvatarStack, stackRing } from "./avatars";

// The conversation's column: the transcript and the composer under it share it, so every block starts and ends on
// the composer box's left and right edges. A block fills it and keeps its own inner padding.
export function ConversationColumn({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto w-full min-w-0", className)} style={{ maxWidth: measure.conversation }}>
      {children}
    </div>
  );
}

// A conversation's scrolling column with the composer floating over its foot: the transcript scrolls under the
// composer's tray and box (opaque, with their own shadows), and ends clear of it, by the composer's measured height.
// A short one sits on the composer, and it stays at its bottom as it grows (`anchor` changes) unless the reader
// scrolled up. `composer` is the tray and box; `foot` the line under the box. A page-coloured strip from the box's
// foot to the window's edge hides the transcript below.
// Within this of the bottom, the person is at the bottom.
const pinnedWithin = 40;
// How long a smooth scroll back takes before a person's scroll decides again.
const scrollBackMs = 600;
// The working line's slot under the last turn: always this tall, filled or empty, so the conversation never moves when
// the line comes or goes. The line sits centred in it, as far from the last turn as from the composer.
const workingSlot = 88;
// The way back to the latest floats this far above the composer.
const wayBackGap = 16;
// The way back's height: hidden, it waits this far plus the gap below its place, behind the composer.
const wayBackHeight = 32;

// `working`: the WorkingLine, centred in its slot last in the column; the slot keeps its height when it is empty.
export function ConversationScroll({ anchor, children, composer, foot, working }: { anchor: string | number; children: ReactNode; composer?: ReactNode; foot?: ReactNode; working?: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [cleared, setCleared] = useState(0);
  // Where the way back sits, from the window's foot: `wayBackGap` above the composer, whatever is under the composer.
  const [over, setOver] = useState(0);
  // Following the bottom: new content scrolls it down only while the person is there. Scrolling up stops it and shows
  // the way back; reaching the bottom again resumes it. Only a person's scroll decides: ours is flagged and its event
  // skipped, so a late layout change (an image decoding, a font swapping) never un-pins it on its own.
  const pinned = useRef(true);
  const ours = useRef(false);
  const [away, setAway] = useState(false);
  const toBottom = (behavior: ScrollBehavior) => {
    const el = scroller.current;
    if (!el) return;
    ours.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior });
    // Past the frame this scroll's event lands in; a smooth scroll keeps the flag until it ends.
    const release = () => requestAnimationFrame(() => requestAnimationFrame(() => (ours.current = false)));
    if (behavior === "smooth") setTimeout(release, scrollBackMs);
    else release();
  };
  useLayoutEffect(() => {
    const el = layer.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const read = () => {
      const whole = el.getBoundingClientRect();
      setCleared(whole.height);
      const own = box.current?.getBoundingClientRect();
      setOver((own ? whole.bottom - own.top : whole.height) + wayBackGap);
    };
    read();
    const watch = new ResizeObserver(read);
    watch.observe(el);
    return () => watch.disconnect();
  }, [!!composer]);
  // While the way back does not show, the column stays at its bottom, whatever moves it: new content (`anchor`), a
  // turn growing inside itself, the composer's height (an approval takes its place, taller, then gives it back), the
  // window or a pane resizing the view.
  useLayoutEffect(() => {
    if (pinned.current) toBottom("auto");
  }, [anchor, cleared]);
  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner || typeof ResizeObserver === "undefined") return;
    const follow = new ResizeObserver(() => {
      if (pinned.current) toBottom("auto");
    });
    // The border box: the composer's clearance is the content's padding, which its content box leaves out.
    follow.observe(inner, { box: "border-box" });
    follow.observe(el);
    return () => follow.disconnect();
  }, []);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => {
          if (ours.current) return;
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < pinnedWithin;
          setAway(!pinned.current);
        }}
      >
        <div ref={content} aria-live="polite" aria-relevant="additions" className="flex min-h-full flex-col justify-end px-10" style={{ paddingBottom: cleared }}>
          {/* Turns are 48 apart, the same 48 as above the first one. */}
          <ConversationColumn className="flex flex-col items-stretch gap-12 pt-12">
            {children}
            {/* The slot starts at the last turn: the column's gap is taken back. Its 16 on top match the composer's
                clearance below it, so the line sits as far from the last turn as from the composer. */}
            <div data-testid="slot:working" className="-mt-12 flex shrink-0 items-center pt-4" style={{ height: workingSlot }}>
              {working}
            </div>
          </ConversationColumn>
        </div>
      </div>
      {/* The way back to the latest, centred over the composer while the person reads above. It rises from behind the
          composer (under its layer) and drops back behind it; reduced motion shows and hides it in place. */}
      <div
        inert={!away || undefined}
        aria-hidden={!away || undefined}
        className="pointer-events-none absolute inset-x-0 z-[5] flex justify-center motion-reduce:!transition-none"
        style={{
          bottom: over,
          opacity: away ? 1 : 0,
          transform: away ? "none" : `translateY(${wayBackGap + wayBackHeight}px)`,
          transition: away
            ? "transform var(--duration-fade) var(--ease-enter), opacity var(--duration-fade) var(--ease-enter)"
            : "transform var(--duration-exit) var(--ease-exit), opacity var(--duration-exit) var(--ease-exit)",
        }}
      >
        <Clickable
          fill={palette.quiet}
          radius={999}
          onClick={() => {
            pinned.current = true;
            setAway(false);
            toBottom("smooth");
          }}
          label="Back to the latest"
          handle="button:Back to the latest"
          className={cn("relative flex items-center gap-1.5 rounded-full bg-page px-3 shadow-lift", away && "pointer-events-auto")}
          style={{ height: wayBackHeight }}
        >
          <Glyph name="arrowDown" size={13} color={palette.secondary} />
          <span className="text-[13px] font-medium text-secondary">Back to the latest</span>
          {/* The edge over the hover fill, so hovering never hides it. */}
          <span aria-hidden className="pointer-events-none absolute inset-0 z-10 rounded-full" style={edge(palette.cardEdge)} />
        </Clickable>
      </div>
      {composer && (
        <div ref={layer} className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col">
          <div className="pointer-events-auto relative z-10 px-10 pt-4">
            <ConversationColumn>
              <div ref={box} data-testid="slot:composer">{composer}</div>
            </ConversationColumn>
          </div>
          <div className="pointer-events-auto bg-page px-10 pb-5">
            <ConversationColumn>{foot}</ConversationColumn>
          </div>
        </div>
      )}
    </div>
  );
}

// What a card keeps left of its text: the page's text edge.
const cardText = textEdge;

// A line cut in its middle when it does not fit, as Text's truncationMode(.middle): the end stays visible. The end
// kept is at most 24 characters, so a long command never pushes past its row.
// `cut` hears whether the line is cut, or was written over several.
function Middle({ text: given, className, style, cut: heard }: { text: string; className?: string; style?: CSSProperties; cut?: (cut: boolean) => void }) {
  // One line: a command written over several reads on one.
  const text = given.replace(/\s*\n\s*/g, " ");
  const cut = Math.max(0, text.length - Math.min(24, Math.ceil(text.length * 0.4)));
  const head = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = head.current;
    if (!heard || !el) return;
    const hear = () => heard(text !== given.trim() || el.scrollWidth > el.clientWidth);
    hear();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(hear);
    watch.observe(el);
    return () => watch.disconnect();
  }, [text, given, heard]);
  return (
    <span className={cn("flex min-w-0 overflow-hidden whitespace-pre", className)} style={style}>
      <span ref={head} className="truncate" style={{ whiteSpace: "pre" }}>{text.slice(0, cut)}</span>
      <span className="shrink-0" style={{ whiteSpace: "pre" }}>{text.slice(cut)}</span>
    </span>
  );
}

// Names as a sentence says them: "Ben", "Ben and Maya", "Ben, Maya and Tom".
export const nameList = (names: string[]) =>
  names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

// Who speaks and when, above a turn: avatar, name, time from the left edge. `end` is a person's own: time, name,
// avatar, ending on the right edge. `for`: the people whose messages an agent's turn answers, named in a tooltip
// on its name.
// `grid`: inside a card, the face on the mark axis and the name on the text edge.
export function TurnHead({ name, time, initials, picture, end, for: requesters, grid }: { name: string; time: string; initials?: string; picture?: string; end?: boolean; for?: string[]; grid?: boolean }) {
  const said = <span className="text-[13px] font-medium text-ink">{name}</span>;
  const face = initials ? <Avatar initials={initials} size={20} src={picture} /> : <LeadView lead={{ agent: true }} size={20} />;
  return (
    <div className={cn("flex h-5 items-center gap-2", end && "flex-row-reverse")}>
      {grid ? (
        <RowMark gap={8}>{face}</RowMark>
      ) : (
        face
      )}
      {requesters?.length ? <Tooltip text={`For ${nameList(requesters)}`}>{said}</Tooltip> : said}
      <span className="text-[13px] text-tertiary">{time}</span>
    </div>
  );
}

// A queued message's actions: white, at the dimmed message's contrast (grey words and glyph, darker on hover), 24 high.
const queuedAction = "h-6 text-[12px] text-tertiary hover:text-secondary";

// A person's message: their head, then a grey block. Queued behind a running turn, its edge is dashed, its fill a
// little greyer and its words dimmed; the head's right says so with a Queued badge (`queued`, the badge's tooltip),
// then Send now (`sendNow`) and Cancel (`cancel`). `from` names the note it was made from. `files`: what was attached,
// as tiles under the block; `open` opens one by index.
export function UserMessage({ author, initials, picture, time, text, queued, cancel, sendNow, from, to, files, open }: {
  author: string; initials: string; picture?: string; time: string;
  text: string; queued?: string; cancel?: () => void; sendNow?: () => void; from?: string; files?: FileView[]; open?: (index: number) => void;
  // A message to a sub-agent: who it went to, and through which agent.
  to?: string;
}) {
  return (
    // One spacing for every gap of a message: under its head, under the text, between its files (12).
    <div className="flex w-full flex-col items-stretch gap-3">
      <div className="flex h-5 min-w-0 items-center gap-2">
        {/* Queued, the head dims with the block; its chip sits right after the time. */}
        <span className={cn("flex min-w-0 shrink-0", queued && "opacity-50")}>
          <TurnHead name={author} time={time} initials={initials} picture={picture} />
        </span>
        {queued && (
          <Tooltip text={queued}>
            <Chip text="Queued" tone="blue" />
          </Tooltip>
        )}
        <span className="min-w-3 flex-1" />
        {sendNow && (
          <Button size="mini" glyph="send" fill={palette.page} className={queuedAction} onClick={sendNow}>
            Send now
          </Button>
        )}
        {cancel && (
          <Button size="mini" glyph="close" fill={palette.page} className={queuedAction} onClick={cancel}>
            Cancel
          </Button>
        )}
      </div>
      {/* 14/22 text on a very light fill, edged as every card of the conversation (card-edge); lines 22 apart, the
          first and the last at the font's own height. Queued, it waits on a slightly grey fill, its words dimmed,
          behind a dashed edge. */}
      <div
        className={cn("w-full rounded-block px-4 py-3 t-prose whitespace-pre-wrap", queued ? "bg-area text-faint" : "bg-quiet text-ink")}
        style={queued ? { border: `1px dashed ${palette.faint}` } : edge(palette.cardEdge)}
      >
        <span className="-my-[2.5px] block"><MentionText text={text} /></span>
      </div>
      {files && files.length > 0 && <FileTiles files={files} open={open} />}
      {from && (
        <div className="flex h-5 items-center gap-1.5">
          <Glyph name="pin" size={11} color={tones.note.ink} />
          <span className="text-[13px] text-tertiary">{from}</span>
        </div>
      )}
      {to && (
        <div className="flex h-5 items-center gap-1.5">
          <Glyph name="bot" size={11} color={palette.tertiary} />
          <span className="text-[13px] text-tertiary">{to}</span>
        </div>
      )}
    </div>
  );
}

// Markdown as the app's theme drew it: Inter 16/24, code in JetBrains Mono on the grey area, blocks 12 apart. The
// 24 point lines add their half leading (2.32) above and under a paragraph; its margin and the frame take it back.
const markdown: Components = {
  p: ({ children }) => <p className="mb-[7.36px]">{children}</p>,
  h1: ({ children }) => <h1 className="my-2 font-display text-[20px] font-medium">{children}</h1>,
  h2: ({ children }) => <h2 className="my-2 font-display text-[18px] font-medium">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-1 mb-1.5 text-[16px] font-semibold">{children}</h3>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ children, href }) => (
    <a href={href} className="text-ink underline">
      {children}
    </a>
  ),
  code: ({ children, className }) =>
    className?.startsWith("language-") || String(children).includes("\n") ? (
      <code className="font-mono text-[12px]">{children}</code>
    ) : (
      // A badge: one line, cut with an ellipsis past the column, set on the text's baseline.
      <code className="inline-block max-w-full truncate rounded-[5px] bg-quiet px-1.5 align-[-5px] font-mono text-[13px] leading-5 whitespace-nowrap shadow-[inset_0_0_0_1px_var(--color-line)]" title={String(children)}>
        {children}
      </code>
    ),
  // A block as a table is drawn: rounded, its edge in the line colour, scrolling sideways inside. Its code is never the
  // inline badge, a single line included.
  pre: ({ children }) => (
    <div className="relative mb-3 overflow-hidden rounded-block bg-quiet">
      <pre className="overflow-x-auto p-3.5 leading-[1.5] [&_code]:inline [&_code]:max-w-none [&_code]:overflow-visible [&_code]:rounded-none [&_code]:bg-transparent [&_code]:p-0 [&_code]:align-baseline [&_code]:text-[12px] [&_code]:leading-[1.5] [&_code]:whitespace-pre [&_code]:shadow-none">{children}</pre>
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-block" style={edge(palette.line)} />
    </div>
  ),
  blockquote: ({ children }) => <blockquote className="mb-3 border-l-2 border-faint pl-3">{children}</blockquote>,
  ul: ({ children, className }) => (
    <ul className={cn("mb-3 pl-6", className?.includes("contains-task-list") ? "list-none pl-0" : "list-disc")}>{children}</ul>
  ),
  ol: ({ children }) => <ol className="mb-3 list-decimal pl-6">{children}</ol>,
  li: ({ children }) => <li className="mt-1 [&>p]:mb-0">{children}</li>,
  input: ({ checked }) => (
    <span className="mr-2 inline-flex translate-y-[2px]">
      <Checkbox on={!!checked} />
    </span>
  ),
  ...conversationTable,
  hr: () => <Rule className="mb-3" />,
};

// The agent speaking: GitHub-flavoured markdown, tables, task lists and code blocks.
export function Prose({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("-my-[2.32px] t-prose text-ink select-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}>
      <Markdown remarkPlugins={[remarkGfm]} components={markdown}>
        {text}
      </Markdown>
    </div>
  );
}

// What a row reports on its right: a measured result, or a person's (or policy's) decision.
export type ActOutcome =
  | { kind: "none" }
  | { kind: "value"; text: string; tone?: Tone }
  | { kind: "decision"; word: string; tone: Tone; by?: string };

export type ActState = "done" | "running" | "failed" | "waiting";

// The tools the agent calls. Gated tools (question, push, pull request) end on a decision.
export type Tool = "read" | "edit" | "write" | "bash" | "grep" | "ask" | "push" | "pr" | "plan" | "agent";

export const tools: Tool[] = ["read", "edit", "write", "bash", "grep", "ask", "push", "pr", "plan", "agent"];

export const Tool = {
  face: (t: Tool): string =>
    ({ read: "read", edit: "edit", write: "edit", bash: "bash", grep: "grep", ask: "mention", push: "push", pr: "pr", plan: "plan", agent: "subagent" })[t],
  label: (t: Tool): string =>
    ({ read: "Read", edit: "Edit", write: "Write", bash: "Run", grep: "Search", ask: "Question", push: "Push", pr: "Pull request", plan: "Plan", agent: "Sub-agent" })[t],
  // Whether the target reads as code.
  mono: (t: Tool): boolean => !["ask", "pr", "plan", "agent"].includes(t),
};

// What a call shows when its row opens (`RunsHelper#run_output`): the call in full, the arguments its row leaves out,
// the change it made as a diff, and what it printed. `args` are the arguments the row's line does not already say.
export type ActDetail = {
  command?: string;
  args?: { key: string; value: string }[];
  diffs?: { file: string; lines: DiffLine[] }[];
  output?: string;
};

export type ActRowProps = {
  target: string;
  outcome?: ActOutcome;
  state?: ActState;
  detail?: ActDetail;
  // Shown open at first.
  opened?: boolean;
} & ({ tool: Tool } | { face: string; label: string; mono: boolean });

const stateColors: Record<ActState, [string, string]> = {
  running: [tones.blue.fill, tones.blue.ink],
  failed: [tones.red.fill, tones.red.ink],
  waiting: [tones.yellow.fill, tones.yellow.ink],
  done: [palette.page, palette.secondary],
};

const opens = (d?: ActDetail) => !!(d && (d.command || d.args?.length || d.output || d.diffs?.length));

// One call: its face, its label, its target and what came of it, all mono 12. With a detail, the row opens in place,
// below its line, to show it; each row opens on its own. A row that cannot open has no chevron: its outcome ends it.
export function ActRow(props: ActRowProps) {
  const { target, outcome = { kind: "none" }, state = "done", detail, opened = false } = props;
  const face = "tool" in props ? Tool.face(props.tool) : props.face;
  const label = "tool" in props ? Tool.label(props.tool) : props.label;
  const [disc, line] = stateColors[state];
  const [open, setOpen] = useState(opened);
  const [whole, setWhole] = useState(true);
  const heard = useCallback((c: boolean) => setWhole(!c), []);
  // The call in full repeats the row's line when that line is whole: it is left out, and a row with nothing else to
  // show does not open.
  const echo = !!detail && detail.command === target;
  const shown = detail && echo && whole ? { ...detail, command: undefined } : detail;
  const can = opens(shown);
  // The fill sits 4 points inside the card, as the counter's; the row's content stays 12 from the card's edge.
  const body = (
    <>
      <RowMark from={4} gap={8}>
        <Face name={face} size={20} disc={disc} line={line} />
      </RowMark>
      {/* The label keeps a 96 column so short ones line their targets up, and takes more when it needs it. What is grey
          in a row (its label, who decided, the card's summary) is mono 12. */}
      <span className="min-w-24 shrink-0 font-mono text-[12px] whitespace-nowrap text-secondary">{label}</span>
      <Middle text={target} cut={echo ? heard : undefined} className="font-mono text-[12px] text-ink" />
      <span className="min-w-3 flex-1" />
      {outcome.kind === "value" &&
        (() => {
          // A state's word (running, failed) is a small chip in its tone; a plain value (a time) stays quiet text.
          const t = outcome.tone ?? (state === "failed" ? "red" : state === "running" ? "blue" : undefined);
          return t ? (
            <Chip text={outcome.text} tone={t} />
          ) : (
            <span className="shrink-0 truncate font-mono text-[12px] text-tertiary tabular-nums">{outcome.text}</span>
          );
        })()}
      {outcome.kind === "decision" && (
        <span className="flex shrink-0 items-center gap-2.5">
          {outcome.by && <span className="truncate font-mono text-[12px] text-tertiary">{outcome.by}</span>}
          <Pill text={outcome.word} tone={outcome.tone} />
        </span>
      )}
      {/* A row that opens ends on its chevron; one that does not ends on its outcome, a badge on the row's right edge. */}
      {can && (
        // Lucide's chevron keeps white on its right: taken back, so its stroke ends on the inset as a badge does.
        <Turn open={open} className={cn(glyphTrim, "w-3.5 shrink-0 justify-center")}>
          <Glyph name="chevronRight" size={13} color={palette.tertiary} width={1.5} />
        </Turn>
      )}
    </>
  );
  return (
    <div className="flex flex-col">
      {can ? (
        <Clickable
          fill={palette.area}
          onClick={() => setOpen(!open)}
          label={open ? `Hide ${label}` : `Show ${label}`}
          handle={`call:${target}`}
          aria-expanded={open}
          className="mx-1 flex h-9 items-center gap-2 pr-1.5"
        >
          {body}
        </Clickable>
      ) : (
        <div className="mx-1 flex h-9 items-center gap-2 pr-1.5">{body}</div>
      )}
      {can && shown && (
        <Accordion open={open}>
          <CallDetail detail={shown} failed={state === "failed"} />
        </Accordion>
      )}
    </div>
  );
}

// The longest output a row shows, as the web's `RunsHelper::OUTPUT`.
const outputCut = 20_000;
// The tallest a block of text grows before it scrolls.
const blockCap = 240;
// An argument longer than this, or on several lines, is shown in a block of its own.
const longValue = 80;
// What a block keeps left of its text: the card's text column less the row fill's edge (4), so the block's fill runs
// on the row's hover fill edges and its text on the row's text.
const blockInset = cardText - 4;

// A call's code, at the card's one mono size, 12.
const code = "font-mono text-[12px] leading-5 whitespace-pre-wrap [overflow-wrap:anywhere] select-text";

// A block on the page's fill: the one look of every piece of an open call (the call in full, its arguments, an output),
// its fill on the row's lead, its text on the row's text.
function Block({ children, failed = false, className }: { children: ReactNode; failed?: boolean; className?: string }) {
  return (
    <div
      className={cn(code, "overflow-y-auto rounded-block py-2 pr-3 text-ink", className)}
      style={{
        paddingLeft: blockInset,
        maxHeight: blockCap,
        background: failed ? tones.red.fill : palette.page,
        ...edge(failed ? alpha(tones.red.ink, toneEdge) : alpha(palette.ink, 0.03)),
      }}
    >
      {children}
    </div>
  );
}

function TextBlock({ children, label, failed = false }: { children: string; label?: string; failed?: boolean }) {
  return (
    <Block failed={failed}>
      {label && <div className="text-tertiary">{label}</div>}
      {children}
    </Block>
  );
}

// An open row's body: every piece a Block on the row's content edges, its text on the text column: the call in full
// when its line is cut, the arguments the line leaves out (short ones as `key value` lines in one block, long ones a
// block each), each diff, then the output. Every piece is 4 apart, on the row fill's edges, as the rows are. A failed call's output sits on the failure's red.
function CallDetail({ detail, failed }: { detail: ActDetail; failed: boolean }) {
  const output = detail.output && detail.output.length > outputCut ? detail.output.slice(0, outputCut) + "\n…" : detail.output;
  const isLong = (v: string) => v.length > longValue || v.includes("\n");
  const short = detail.args?.filter((a) => !isLong(a.value)) ?? [];
  const long = detail.args?.filter((a) => isLong(a.value)) ?? [];
  return (
    <div className="flex flex-col gap-1 px-1 pt-1 pb-1" data-testid="call:detail">
      {detail.command && <Block>{detail.command}</Block>}
      {short.length > 0 && (
        <Block>
          <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3" data-testid="call:args">
            {short.map((a) => (
              <div key={a.key} className="contents">
                <dt className="text-tertiary">{a.key}</dt>
                <dd className="m-0">{a.value}</dd>
              </div>
            ))}
          </dl>
        </Block>
      )}
      {long.map((a) => (
        <TextBlock key={a.key} label={a.key}>
          {a.value}
        </TextBlock>
      ))}
      {detail.diffs?.map((d, i) => (
        <DiffBlock key={i} file={d.file} lines={d.lines} numbers={false} fill={palette.page} inset={blockInset} />
      ))}
      {output && (
        <TextBlock failed={failed}>{output}</TextBlock>
      )}
    </div>
  );
}

// The box of a ConversationActivityCard: a very light fill, rounded, on the card edge. Its dividers are CardRule.
function ActivityBox({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex w-full flex-col rounded-block bg-quiet", className)} style={edge(palette.cardEdge)}>
      {children}
    </div>
  );
}

// Everything the agent did between two things it said (the machine's setup, its calls, the decisions on them), under
// one counter with its total time. Only the agent's words come between two cards. It starts folded (`open` is for the
// gallery's opened state): while the agent works its line says the last action, once it speaks their summary. It
// spans its column, open or closed.
export type ConversationActivityCardProps = { summary: string; time: string; rows: ActRowProps[]; open?: boolean };

// A finished turn's closing line, quiet, under its last words: how long it took, its tool calls and the files it
// changed. The files part opens the Changes view. No cost: spend lives in Usage.
export function TurnTally({ time, tools, files, open }: { time: string; tools: number; files?: { count: number; added: number; removed: number } | null; open?: () => void }) {
  const dot = <span style={{ color: palette.faint }}>·</span>;
  const changed = files && files.count > 0 && (
    <>
      <span>{files.count === 1 ? "1 file" : `${files.count} files`}</span>
      <span style={{ color: tones.green.ink }}>+{files.added}</span>
      <span style={{ color: tones.red.ink }}>−{files.removed}</span>
    </>
  );
  return (
    <div data-testid="tally:turn" className="flex flex-wrap items-center gap-x-2 font-mono text-[12px] leading-5 text-tertiary tabular-nums">
      {time && (
        <>
          <span>{time}</span>
          {dot}
        </>
      )}
      <span>{tools === 1 ? "1 tool" : `${tools} tools`}</span>
      {changed && (
        <>
          {dot}
          {open ? (
            <Clickable fill={palette.quiet} radius={4} onClick={open} label="Open the changes" handle="button:Open the changes" className="-mx-1 flex items-center gap-1.5 px-1">
              {changed}
            </Clickable>
          ) : (
            <span className="flex items-center gap-1.5">{changed}</span>
          )}
        </>
      )}
    </div>
  );
}

// What the agent did between two things it said, as one card on one line that opens like an accordion on their rows.
export function ConversationActivityCard({ summary, time, rows, open: opened = false }: ConversationActivityCardProps) {
  const [open, setOpen] = useState(opened);
  const shown = open && rows.length > 0;
  return (
    <ActivityBox>
      {/* The hover fill sits 4 points inside the card, so it never meets the card's corners. */}
      <Clickable fill={palette.area} onClick={() => setOpen(!open)} handle={`card:${summary}`} className="m-1 flex h-7 items-center gap-2.5 pr-1.5">
        <RowMark from={4} gap={10}>
          <Turn open={shown} className="justify-center">
            <Glyph name="chevronRight" size={15} color={palette.tertiary} width={1.5} />
          </Turn>
        </RowMark>
        <span className="truncate font-mono text-[12px] text-secondary">{summary}</span>
        <span className="shrink-0 font-mono text-[12px] text-tertiary tabular-nums">{time}</span>
      </Clickable>
      <Accordion open={shown}>
        <CardRule />
        <div className="flex flex-col py-1">
          {rows.map((row, i) => (
            <ActRow key={i} {...row} />
          ))}
        </div>
      </Accordion>
    </ActivityBox>
  );
}

// Lines of text not loaded yet, 24 apart as prose is: each bar is the share of the line it fills.
function SkeletonLines({ shares, bar }: { shares: number[]; bar?: string }) {
  return (
    <div className="-my-[2.32px] flex flex-col">
      {shares.map((share, i) => (
        <div key={i} className="flex h-6 items-center">
          <Skeleton className={cn("h-3", bar)} style={{ width: `${share}%` }} />
        </div>
      ))}
    </div>
  );
}

// Who speaks, not loaded yet: a disc, then a name and a time; `end` as a person's own head, on the right edge.
function SkeletonHead({ name, time, end }: { name: number; time: number; end?: boolean }) {
  return (
    <div className={cn("flex h-5 items-center gap-2", end && "flex-row-reverse")}>
      <Skeleton className="size-5" />
      <Skeleton className="h-3" style={{ width: name }} />
      <Skeleton className="h-3" style={{ width: time }} />
    </div>
  );
}

// A call row not loaded yet, at the real row's height: its round lead, its label and its target.
function SkeletonCall({ target }: { target: number }) {
  return (
    <div className="mx-1 flex h-9 items-center gap-2 px-2">
      <Skeleton className="size-5" />
      <span className="flex w-24 shrink-0"><Skeleton className="h-3 w-14" /></span>
      <Skeleton className="h-3" style={{ width: target }} />
    </div>
  );
}

// A conversation not loaded yet, on the real transcript's columns so nothing moves when it arrives: a person's
// message, the agent's paragraph, an action card of three calls, a second paragraph, and the composer's tray and box.
// It fills the session page's body, as ConversationScreen does.
export function ConversationSkeleton() {
  // Groups are 32 apart, the blocks of a group 16, as the screen draws them.
  return (
    <div aria-label="Loading" className="flex h-full min-h-0 flex-col bg-page">
      <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden px-10">
        <ConversationColumn className="flex flex-col items-stretch gap-12 pt-12 pb-6">
          <div className="flex flex-col items-stretch gap-3">
            <SkeletonHead name={48} time={32} end />
            <div className="w-full rounded-block bg-quiet px-4 py-3" style={edge(palette.cardEdge)}>
              <SkeletonLines shares={[82, 46]} bar="bg-line" />
            </div>
          </div>
          <div className="flex flex-col items-stretch gap-3">
            <SkeletonHead name={36} time={32} />
            <SkeletonLines shares={[96, 88, 58]} />
            <ActivityBox>
              <div className="m-1 flex h-7 items-center gap-2.5 px-2">
                <span className="-mr-0.5 flex w-5 justify-center"><Skeleton className="size-3" /></span>
                <Skeleton className="h-3 w-48" />
                <Skeleton className="h-3 w-8" />
              </div>
              <CardRule />
              <div className="flex flex-col py-1">
                <SkeletonCall target={220} />
                <SkeletonCall target={150} />
                <SkeletonCall target={190} />
              </div>
            </ActivityBox>
            <SkeletonLines shares={[92, 64]} />
          </div>
        </ConversationColumn>
      </div>
      <div className="relative flex shrink-0 justify-center px-10 pt-4 pb-5">
        <ConversationColumn className="flex flex-col">
          {/* The tray is 34 high over the 12 the box overlaps; the box holds its field line and its action line. */}
          <div className="flex h-[46px] items-start justify-between rounded-t-block bg-quiet px-[18px] pt-[11px]" style={edge(palette.line)}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
          <div className="-mt-3 flex h-[88px] flex-col justify-between rounded-panel bg-page px-7 py-3.5 shadow-composer">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </ConversationColumn>
      </div>
    </div>
  );
}


// What went wrong in a turn: a red dot and what failed; the message as it was printed folds under it. Folded by
// default: the page says the cause and the fix elsewhere.
export function ErrorBlock({ title, text, folded = true }: { title: string; text: string; folded?: boolean }) {
  const [open, setOpen] = useState(!folded);
  return (
    <div role="alert" className="flex flex-col rounded-block bg-red-fill" style={edge(alpha(tones.red.ink, toneEdge))}>
      <Clickable
        fill={alpha(tones.red.ink, 0.06)}
        onClick={() => setOpen(!open)}
        label={open ? "Hide the message" : "Show the message"}
        className="m-1 flex h-7 items-center gap-2.5 pr-1.5"
      >
        <RowMark from={4} gap={10}>
          <Dot tone="red" />
        </RowMark>
        <span className="truncate text-[14px] text-red-ink">{title}</span>
        <Turn open={open}>
          <Glyph name="chevronRight" size={10} color={tones.red.ink} width={1.8} />
        </Turn>
      </Clickable>
      <Accordion open={open}>
        <div className="h-px" style={{ background: alpha(tones.red.ink, toneEdge) }} />
        <div className="py-[10px] pr-4 font-mono text-[12px] leading-5 whitespace-pre-wrap text-ink select-text" style={{ paddingLeft: cardText }}>
          {text}
        </div>
      </Accordion>
    </div>
  );
}

// A sub-agent the agent started, or a workflow step it handed on: its name, its last line, where it stands and
// its facts (time, tools, tokens).
export type SubagentRun = { id: string; name: string; line: string; state: "done" | "running" | "failed"; facts?: string };

// The sub-agents (or steps) of a turn as one card: a tally, then a row each with its mark, face, name, last line
// and facts. With `open`, a row opens its conversation.
export function SubagentCard({ title = "Sub-agents", runs, open }: { title?: string; runs: SubagentRun[]; open?: (run: SubagentRun) => void }) {
  const words: [SubagentRun["state"], string][] = [["done", "done"], ["running", "running"], ["failed", "failed"]];
  const tally = [
    title,
    ...words.flatMap(([state, word]) => {
      const n = runs.filter((r) => r.state === state).length;
      return n > 0 ? [`${n} ${word}`] : [];
    }),
  ].join(" · ");
  return (
    <ActivityBox>
      <div className="flex h-9 items-center text-[14px] text-secondary" style={{ paddingLeft: cardText, paddingRight: edgeInset }}>
        <span className="truncate">{tally}</span>
      </div>
      <CardRule />
      <div className="flex flex-col p-1">
        {runs.map((run) =>
          open ? (
            <Clickable key={run.id} fill={palette.area} onClick={() => open(run)} handle={`run:${run.name}`}>
              <SubagentRow run={run} link />
            </Clickable>
          ) : (
            <SubagentRow key={run.id} run={run} link={false} />
          ),
        )}
      </div>
    </ActivityBox>
  );
}

function SubagentRow({ run, link }: { run: SubagentRun; link: boolean }) {
  const [disc, ink] = run.state === "running" ? [tones.blue.fill, tones.blue.ink] : run.state === "failed" ? [tones.red.fill, tones.red.ink] : [palette.page, palette.secondary];
  // With the card's 4 point inset, the face on the mark axis and the name on the text edge.
  return (
    <div className="flex h-9 items-center gap-2 pr-1.5">
      <RowMark from={4} gap={8}>
        <Face name="subagent" size={20} disc={disc} line={ink} />
      </RowMark>
      <span className="shrink-0 text-[13px] font-medium whitespace-nowrap text-ink">{run.name}</span>
      <span className="min-w-0 truncate text-[13px]" style={{ color: run.state === "failed" ? tones.red.ink : palette.tertiary }}>
        {run.line}
      </span>
      <span className="min-w-3 flex-1" />
      {run.facts && <span className="shrink-0 font-mono text-[12px] whitespace-nowrap text-tertiary tabular-nums">{run.facts}</span>}
      <span className="flex w-4 shrink-0 justify-center" aria-label={run.state === "done" ? "Done" : run.state === "running" ? "Running" : "Failed"}>
        {run.state === "done" ? <Glyph name="check" size={11} color={tones.green.ink} width={2} /> : run.state === "running" ? <Spinner size={12} color={tones.blue.dot} /> : <Dot tone="red" />}
      </span>
      {link && <Glyph name="chevronRight" size={10} color={palette.tertiary} width={1.6} />}
    </div>
  );
}

// The frame shared by approvals and questions: a header strip in the tone (a dot, the label, the details on the
// right) over a white body holding the decision. The tone is the strip only, so the decision sits on the cleanest
// surface.
export function GateCard({
  tone, label, meta, kind = "gate", children,
}: { tone: Tone; label: string; meta: string; kind?: string; children: ReactNode }) {
  const t = tones[tone];
  const line = alpha(t.ink, toneEdge);
  return (
    <div
      data-testid={`${kind}:${label}`}
      className="flex w-full flex-col items-stretch overflow-hidden rounded-block bg-page"
      style={edge(line)}
    >
      <div className="flex items-center gap-2 px-[18px] py-3" style={{ background: t.fill, color: t.ink, boxShadow: `inset 0 -1px 0 ${line}` }}>
        <Dot tone={tone} />
        <span className={cn(monoCaps, "shrink-0 font-medium whitespace-nowrap")}>{label}</span>
        <span className="min-w-3 flex-1" />
        <span className="truncate font-mono text-[12px]" style={{ color: t.ink }}>{meta}</span>
      </div>
      <div className="flex flex-col items-stretch gap-3 px-[18px] py-[18px]">{children}</div>
    </div>
  );
}

// A call waiting on a decision: Allow and Deny for the person who decides, or, with `decider`, read only and
// waiting on that person (a call in a teammate's tab).
export function Approval({
  title, tool, detail, added, removed, decider, allow, deny,
}: {
  title: string; tool: string; detail: string; added?: number; removed?: number; decider?: string; allow?: () => void; deny?: () => void;
}) {
  const parts = [tool, detail];
  if (added !== undefined) parts.push(`+${added}` + (removed !== undefined ? ` −${removed}` : ""));
  const meta = parts.filter(Boolean).join(" · ");
  return (
    <GateCard tone="yellow" label={decider ? "Needs approval" : "Needs your approval"} meta={meta} kind="approval">
      <div className="flex items-center gap-3">
        <span className="line-clamp-2 text-[14.5px] leading-5 font-medium tracking-[-0.17px]">{title}</span>
        <span className="min-w-3 flex-1" />
        {decider ? (
          <span className="flex h-8 shrink-0 items-center text-[13px] whitespace-nowrap" style={{ color: tones.yellow.ink }}>
            Waiting on {decider}
          </span>
        ) : (
          <>
            <Button kind="primary" size="small" onClick={allow}>
              Allow
            </Button>
            <Button size="small" onClick={deny}>
              Deny
            </Button>
          </>
        )}
      </div>
    </GateCard>
  );
}

export type QuestionOption = { title: string; detail: string };

// One question of an `ask_user` call: its text, an optional short header, whether several options can be picked,
// and its options. A question without options takes only the person's own words.
export type GateQuestion = { question: string; header?: string; multiple?: boolean; options: QuestionOption[] };

// What a person answered to a call's questions, by question index: the labels picked and their own words.
// This is the body `POST /sessions/{id}/approvals` takes as `answers` and `notes`.
export type GateAnswer = { picks: Record<number, string[]>; notes: Record<number, string> };

export const GateAnswer = {
  // Picks by option index and notes as typed, read against the questions. Empty notes drop out.
  of(questions: GateQuestion[], picks: Record<number, Set<number>>, notes: Record<number, string>): GateAnswer {
    const p: Record<number, string[]> = {};
    const n: Record<number, string> = {};
    questions.forEach((q, i) => {
      const labels = [...(picks[i] ?? [])].sort((a, b) => a - b).filter((k) => k >= 0 && k < q.options.length).map((k) => q.options[k].title);
      if (labels.length) p[i] = labels;
      const note = (notes[i] ?? "").trim();
      if (note) n[i] = note;
    });
    return { picks: p, notes: n };
  },
  // Whether every question has a pick or words.
  complete(answer: GateAnswer, count: number): boolean {
    return Array.from({ length: count }, (_, i) => i).every((i) => answer.picks[i] !== undefined || answer.notes[i] !== undefined);
  },
};

export type QuestionProps = {
  question: GateQuestion;
  // Where it stands among several ("1 of 2").
  step?: string;
  // The chosen options' indexes; without them the card keeps its own choice, starting at `chosen`.
  selection?: Set<number>;
  onSelect?: (picks: Set<number>) => void;
  chosen?: number;
  // The person's own words; with `onNote` a field for them shows.
  note?: string;
  onNote?: (text: string) => void;
  // Numbers the options and binds their digits; off when several questions show at once.
  keys?: boolean;
  // The asking agent's name, from its session.
  agent?: string;
};

// A question asked in a card: the prompt, its options (a radio each, or a checkbox each when several can be
// picked) and, with `onNote`, a link that opens a field for the person's own words.
export function Question({ question, step = "", selection, onSelect, chosen, note, onNote, keys = true, agent = "The agent" }: QuestionProps) {
  const [local, setLocal] = useState<Set<number>>(() => new Set(chosen !== undefined ? [chosen] : []));
  const picks = selection ?? local;
  const meta = [question.header, step].filter((s): s is string => !!s).join(" · ");
  return (
    <GateCard tone="blue" label={`${agent} asks`} meta={meta}>
      <QuestionBody
        question={question}
        picks={picks}
        onPicks={(p) => (onSelect ? onSelect(p) : setLocal(p))}
        note={onNote ? { value: note ?? "", onChange: onNote } : undefined}
        keys={keys}
        fill={palette.area}
        marks="card"
      />
    </GateCard>
  );
}

// A question's prompt, options and own-words field, shared by the card and the composer's gate.
// How far a composer gate's option rows reach past their mark slot on the left (the fill's edge).
const optionReach = 4;
// Where those rows start, left of the text edge: the mark slot, centred on the mark axis, and the reach.
const dotMarks = textEdge - (markAxis - markSlot / 2) + optionReach;

export function QuestionBody({
  question, picks, onPicks, note, keys, fill, ink = palette.ink, marks = "inset",
}: {
  question: GateQuestion;
  picks: Set<number>;
  onPicks: (picks: Set<number>) => void;
  note?: { value: string; onChange: (text: string) => void };
  keys: boolean;
  fill: string;
  ink?: string;
  // "card": each option a card on the question's text edge, its title over its detail, on `fill`; the chosen one on
  // white with an ink ring, no mark (the agreed question face, also on a toned surface). "lead": the options' marks
  // sit in the card's lead column and their titles on the question's text; "dot": the same in a dot's column, the
  // marks centred on the dot; "inset": the rows' fills reach 8 points past the text on both sides.
  marks?: "card" | "lead" | "dot" | "inset";
}) {
  const [own, setOwn] = useState(false);
  const pick = (i: number) => {
    if (question.multiple) {
      const next = new Set(picks);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      onPicks(next);
    } else {
      onPicks(new Set([i]));
      // One choice: an option and your own words exclude each other.
      if (marks === "card" && note) {
        setOwn(false);
        note.onChange("");
      }
    }
  };
  // Your own answer, open: its field shows and the options step back.
  const writing = marks === "card" && !!note && (own || note.value !== "");
  // As a card, your own answer is one more choice; picked, its field opens under it.
  const chooseOwn = () => {
    setOwn(true);
    if (!question.multiple) onPicks(new Set());
  };
  return (
    // As cards, every item stands 17 from the next: the question, each option, your own answer.
    <div className={cn("flex flex-col items-stretch", marks === "card" ? "gap-[17px]" : "gap-2")}>
      {/* As cards, the agent's short title for the question stands over it: blue, uppercase mono. */}
      <span className="flex flex-col gap-1.5">
        {marks === "card" && question.header && (
          <span className={cn(monoCaps, "font-medium")} style={{ color: tones.blue.ink }}>
            {question.header}
          </span>
        )}
        <span className={cn("leading-5 tracking-[-0.17px]", marks === "card" ? "text-[15px] font-semibold" : "text-[14.5px] font-medium")} style={{ color: ink }}>
          {question.question}
        </span>
      </span>
      {question.options.length > 0 && marks === "card" && (
        <div className="flex flex-col gap-[17px]">
          {question.options.map((option, i) => (
            // While your own answer is open the options step back, half seen; a hover brings one back, a click picks it.
            <div key={i} className={cn("transition-opacity duration-150", writing && "opacity-50 hover:opacity-100")}>
              <OptionCard index={i + 1} option={option} on={picks.has(i)} keys={keys} fill={fill} pick={() => pick(i)} />
            </div>
          ))}
          {/* Your own answer is one more choice; picked, the card morphs into its field. Focusing the field unselects
              the options; picking an option closes it. */}
          {note &&
            (own || note.value !== "" ? (
              <ChoiceField title="Your own answer" placeholder="In your own words" value={note.value} onChange={note.onChange} onFocus={chooseOwn} autoFocus />
            ) : (
              <Choice title="Your own answer" detail="In your own words" selected={false} onClick={chooseOwn} />
            ))}
        </div>
      )}
      {question.options.length > 0 && marks !== "card" && (
        <div className="flex flex-col gap-0.5" style={marks === "lead" ? { marginLeft: -36, marginRight: -12 } : marks === "dot" ? { marginLeft: -dotMarks, marginRight: -8 } : { marginInline: -8 }}>
          {question.options.map((option, i) => (
            <OptionRow key={i} index={i + 1} option={option} on={picks.has(i)} multiple={question.multiple} keys={keys} fill={fill} tight={marks === "dot"} pick={() => pick(i)} />
          ))}
        </div>
      )}
      {note && !(marks === "card" && question.options.length > 0) &&
        (question.options.length === 0 || own || note.value !== "" ? (
          <TextInput placeholder="Your own answer" value={note.value} onChange={note.onChange} rows={2} />
        ) : (
          <span>
            <Button kind="quiet" size="small" onClick={() => setOwn(true)}>
              Write your own answer
            </Button>
          </span>
        ))}
    </div>
  );
}

// One answer as a Choice card, full width: its title over its detail, its radio on the right, ringed once chosen.
// With `keys` its digit picks it.
export function OptionCard({ index, option, on, keys, fill, pick }: { index: number; option: QuestionOption; on: boolean; keys: boolean; fill: string; pick: () => void }) {
  const latest = useRef(pick);
  latest.current = pick;
  useEffect(() => {
    if (!keys) return;
    const key = String(Math.min(index, 9));
    const press = (e: KeyboardEvent) => {
      if (e.key !== key || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA"].includes(target.tagName))) return;
      latest.current();
    };
    addEventListener("keydown", press);
    return () => removeEventListener("keydown", press);
  }, [keys, index]);
  // The design system's choice card: title over detail, the radio on the right, a ring once chosen; full width.
  return <Choice title={option.title} detail={option.detail ?? ""} selected={on} onClick={pick} />;
}

// One answer: the mark sits where the question's text starts, a radio for one choice, a checkbox for several.
// With `keys` its number shows and its digit picks it.
export function OptionRow({
  index, option, on, multiple = false, keys = true, fill = palette.quiet, tight, pick,
}: { index: number; option: QuestionOption; on: boolean; multiple?: boolean; keys?: boolean; fill?: string; tight?: boolean; pick: () => void }) {
  const latest = useRef(pick);
  latest.current = pick;
  useEffect(() => {
    if (!keys) return;
    const key = String(Math.min(index, 9));
    const press = (e: KeyboardEvent) => {
      if (e.key !== key || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA"].includes(target.tagName))) return;
      latest.current();
    };
    addEventListener("keydown", press);
    return () => removeEventListener("keydown", press);
  }, [keys, index]);
  return (
    <Clickable fill={fill} active={on} onClick={pick} label={option.title} handle={`option:${option.title}`} chosen={on} style={tight ? { paddingLeft: optionReach } : on ? edge(palette.ink, 1.5) : undefined} className={cn("flex items-center", tight ? "h-9" : "h-10 gap-2 px-2")}>
      {/* Tight: the mark sits in the composer's mark slot, so it is centred on the mark axis. */}
      <span className={cn("flex shrink-0 justify-center", !tight && "w-5")} style={tight ? { width: markSlot, marginRight: textEdge - markAxis - markSlot / 2 } : undefined}>{multiple ? <Checkbox on={on} /> : <Radio on={on} />}</span>
      <span className={cn("shrink-0 text-[14px] text-ink", on && "font-medium")}>{option.title}</span>
      <span className={cn("min-w-0 truncate text-[13px] text-tertiary", tight && "ml-1")}>{option.detail}</span>
      <span className="min-w-2 flex-1" />
      {keys && <Kbd k={String(index)} />}
    </Clickable>
  );
}

// A reply under a note.
export type NoteReply = { author: string; initials: string; time: string; text: string };

// A mention as people write it: @ and a name (letters, digits, dots, dashes).
const mention = /(@[\p{L}][\p{L}\p{N}._-]*)/u;

// Text with its mentions semibold, agents and people alike.
export function MentionText({ text }: { text: string }) {
  return <>{text.split(mention).map((part, i) => (i % 2 === 0 ? part : <span key={i} className="font-semibold">{part}</span>))}</>;
}

// A note: one light sage, one text size (13), its edge and its head's divider the sage ink at the tones' edge.
const noteEdge = alpha(tones.note.ink, toneEdge);
const noteFill = `color-mix(in oklab, ${tones.note.fill} 45%, ${palette.page})`;

export type NoteProps = {
  author: string;
  initials: string;
  // The author's picture, in place of their initials.
  picture?: string;
  time: string;
  text: string;
  // Its replies: under the note a line says how many, who and when; the replies themselves are read in the thread.
  replies?: NoteReply[];
  sent?: boolean;
  send?: () => void;
  // Opens the note's thread, where its replies are read and written.
  thread?: () => void;
};

// The people of a thread, once each, in the order they first replied.
const repliers = (replies: NoteReply[]) => [...new Map(replies.map((r) => [r.author, { initials: r.initials, name: r.author }])).values()];

// A note for the team, in the flow of the conversation as a person's message is: one light sage area, its head (who,
// when, a small label, its actions on the right) over a divider, then its words on the name's column. Replies live in
// its thread, as in Slack: under the words, how many, who and when; a click opens the thread. Never sent to the agent
// unless asked; once sent, its button says so and takes no clicks.
// The repliers' faces under a note: the first one centred on the mark axis, under the author's, with the icons. The
// stack pads each side by its ring (`stackRing`), so the row starts that much before the face.
const replyFace = 20;
const replyStart = markAxis - replyFace / 2 - stackRing;

export function Note({ author, initials, picture, time, text, replies = [], sent, send, thread }: NoteProps) {
  const last = replies[replies.length - 1];
  const actions = thread || send;
  return (
    <div className="relative flex w-full min-w-0 flex-col overflow-hidden rounded-block" style={{ background: noteFill }}>
      {/* The edge is drawn over the strip, so the strip never covers it. */}
      <span aria-hidden className="pointer-events-none absolute inset-0 z-10 rounded-block" style={edge(noteEdge)} />
      <ToneStrip tone="note" label="Internal note" glyph="pin" />
      {/* Inside: who wrote it, then the words on the name's column. */}
      <div className="flex flex-col items-stretch gap-2 pt-3 pb-3.5" style={{ paddingRight: edgeInset }}>
        <TurnHead name={author} time={time} initials={initials} picture={picture} grid />
        <span className="t-prose whitespace-pre-wrap text-ink select-text" style={{ paddingLeft: textEdge }}>
          <MentionText text={text} />
        </span>
      </div>
      {/* A small footer under a line: the replies on the left, their first face on the mark axis; the actions on the right. */}
      {(last || actions) && (
        <div className="flex h-10 shrink-0 items-center gap-2" style={{ paddingLeft: replyStart, paddingRight: edgeInset, boxShadow: `inset 0 1px 0 ${noteEdge}` }}>
          {last && (
            <Clickable fill={alpha(tones.note.ink, 0.08)} radius={6} bleed={6} onClick={thread} label="Open the thread" handle={`thread:${author} ${time}`} className="flex min-w-0 items-center gap-2 py-1">
              {/* The faces fill the mark column, so "1 reply" starts on the text edge, under the author's name; more faces
                  than the column holds push it right. */}
              <span className="flex shrink-0" style={{ minWidth: textEdge - replyStart - 8, marginRight: textEdge - replyStart - 8 - (replyFace + 2 * stackRing) }}>
                <AvatarStack people={repliers(replies)} size={replyFace} limit={4} ring={noteFill} />
              </span>
              <span className="text-[13px] font-semibold whitespace-nowrap" style={{ color: tones.note.ink }}>
                {replies.length === 1 ? "1 reply" : `${replies.length} replies`}
              </span>
              <span className="truncate text-[13px] text-tertiary">Last reply {last.time}</span>
            </Clickable>
          )}
          <span className="min-w-3 flex-1" />
          {thread && (
            <Tooltip text="Reply in thread">
              <IconButton glyph="reply" label="Reply in thread" size={24} tone="note" onClick={thread} />
            </Tooltip>
          )}
          {send && (
            <Tooltip text={sent ? "Sent to the agent" : "Send to the agent"}>
              <IconButton glyph="send" label={sent ? "Sent to the agent" : "Send to the agent"} size={24} tone="note" disabled={sent} onClick={send} />
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}

// A note's thread, in a drawer: the note as the conversation shows it, its replies one under the other, then a field
// to reply. Each reply is a person's head and words on the name's column.
export function NoteThread({ note, replies = [], reply }: { note: Omit<NoteProps, "replies" | "thread" | "send" | "sent">; replies?: NoteReply[]; reply?: (text: string) => void }) {
  const [draft, setDraft] = useState("");
  const trimmed = draft.trim();
  const submit = () => {
    if (!trimmed || !reply) return;
    reply(trimmed);
    setDraft("");
  };
  return (
    <div className="flex flex-col items-stretch gap-5">
      <Note {...note} />
      {replies.length > 0 && (
        <div className="flex flex-col items-stretch gap-3.5">
          <GroupTitle title="Replies" count={replies.length} />
          {replies.map((r, i) => (
            <div key={i} className="flex flex-col gap-1">
              <TurnHead name={r.author} time={r.time} initials={r.initials} />
              <span className="pl-7 t-prose whitespace-pre-wrap text-ink select-text">
                <MentionText text={r.text} />
              </span>
            </div>
          ))}
        </div>
      )}
      {reply && (
        <div className="flex flex-col items-end gap-2">
          <TextInput placeholder="Reply…" value={draft} onChange={setDraft} rows={2} autoFocus onSubmit={submit} className="w-full" />
          <Button kind="primary" size="small" disabled={!trimmed} onClick={submit}>
            Reply
          </Button>
        </div>
      )}
    </div>
  );
}

export type ToastProps = {
  text: string;
  tone?: Tone;
  // A spinner in the dot's place, for something under way.
  spin?: boolean;
  detail?: string;
  // One thing to do about it ("Undo", "View").
  action?: string;
  perform?: () => void;
  // Adds a dismiss button.
  close?: () => void;
};

// A short word over the window: a dot or a spinner, the text, a detail, one action, dismiss. The live socket uses
// it for "Reconnecting…" (`spin`) and "Offline" (grey, Retry).
export function Toast({ text, tone, spin, detail, action, perform, close }: ToastProps) {
  useFloat();
  return (
    <div
      role="status"
      data-testid={`toast:${text}`}
      className="inline-flex h-10 w-max shrink-0 items-center gap-2.5 rounded-block bg-page pl-3.5"
      style={{
        paddingRight: close ? 8 : 14,
        boxShadow: `inset 0 0 0 1px ${alpha(palette.ink, 0.03)}, 0 0 0.5px ${alpha(palette.ink, 0.06)}, 0 6px 10px rgb(0 0 0 / 0.08)`,
      }}
    >
      {spin ? <Spinner size={12} color={tone ? tones[tone].dot : palette.tertiary} /> : tone ? <Dot tone={tone} /> : null}
      <span className="text-[14px] whitespace-nowrap text-ink">{text}</span>
      {detail && <span className="text-[14px] whitespace-nowrap text-tertiary">{detail}</span>}
      {action && (
        <span className="pl-2">
          <Button kind="link" size="small" onClick={perform}>
            {action}
          </Button>
        </span>
      )}
      {close && <IconButton glyph="close" label="Dismiss" size={24} onClick={close} />}
    </div>
  );
}

// Where a page's toast sits: centred, 24pt above the bottom of the surface holding it, over everything.
export function ToastLayer({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  usePresence(root);
  return (
    <div ref={root} className="pointer-events-none absolute inset-x-0 bottom-6 z-50 flex justify-center">
      <div className="presence-panel presence-toast pointer-events-auto">{children}</div>
    </div>
  );
}

export type NoticeProps = {
  text: string;
  tone: Tone;
  title?: string;
  // One button on the right ("Restore", "Open billing").
  action?: string;
  perform?: () => void;
};

export function Notice({ text, tone, title, action, perform }: NoticeProps) {
  const t = tones[tone];
  const root = useRef<HTMLDivElement>(null);
  usePresence(root);
  return (
    <div ref={root}>
    <div
      role={tone === "red" ? "alert" : undefined}
      data-testid={`notice:${title ?? text}`}
      className="presence-panel presence-toast flex w-full items-start rounded-button py-3 pr-3.5"
      style={{
        gap: 10,
        paddingLeft: 14,
        color: t.ink,
        background: t.fill,
        ...edge(alpha(t.ink, toneEdge)),
      }}
    >
      {/* The dot sits in the middle of the first line, one line of the text's size high. */}
      <span className="flex h-[1lh] shrink-0 items-center justify-center text-[14px]">
        <Dot tone={tone} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title && <span className="text-[14px] font-medium">{title}</span>}
        <span className="text-[14px]">{text}</span>
      </div>
      {action && (
        <OnTone.Provider value={tone}>
          <Button size="small" onClick={perform}>
            {action}
          </Button>
        </OnTone.Provider>
      )}
    </div>
    </div>
  );
}

// The line under the last turn: what the session is doing now. Its slot is always there. `action` names what can
// be done now ("Open log"); the agent is stopped from the composer's button. While something runs (the agent works, the machine starts) its mark turns;
// waiting on a person, it is a still dot.
// `stop`: while the agent works, an x right after the time stops it.
export function WorkingLine({
  text, tone, time, action, perform, stop,
}: { text: string; tone: Tone; time?: string; action?: string; perform?: () => void; stop?: () => void }) {
  const turning = tone === "blue" || tone === "orange";
  return (
    <div role="status" className="flex h-6 w-full items-center gap-2.5">
      {/* Outside a card, the line starts on the column's edge: its mark in a 20 wide slot as a turn head's face, its words
          where the head's name starts. */}
      <span className="flex w-5 shrink-0 justify-center" style={{ marginRight: -2 }}>
        {turning ? <Spinner size={12} color={tones[tone].dot} /> : <Dot tone={tone} />}
      </span>
      {/* The words and the time share a baseline: centring their boxes leaves the mono digits higher than the lower-case words. */}
      <span className="flex min-w-0 items-baseline gap-2.5">
        <span className="truncate text-[14px] text-secondary">{text}</span>
        {time && <span className="shrink-0 font-mono text-[12px] text-tertiary tabular-nums">{time}</span>}
        {stop && (
          <span className="self-center">
            <Tooltip text="Stop">
              <IconButton glyph="close" label="Stop" size={20} onClick={stop} />
            </Tooltip>
          </span>
        )}
      </span>
      <span className="flex-1" />
      {action && (
        <Button kind="quiet" size="small" onClick={perform}>
          {action}
        </Button>
      )}
    </div>
  );
}

export type DiffLine = {
  // The line's number on the new side; on the old side for a removed line.
  number?: number;
  // A context line's number on the old side, for the split view.
  old?: number;
  text: string;
  kind?: "context" | "added" | "removed";
};

// JetBrains Mono's advance is 0.6 em: a digit is 7.5 points at 12.5.
const digit = 7.5;
// Where a header's title starts: over the code, past the library's gutter of at least four digits.
const codeStart = (n: number) => 16 + n * digit + 28;
const digits = (count: number) => Math.max(4, String(count).length);

// Both sides of these lines as whole files, so the library holds the full diff (a partial patch waits for files it
// cannot load). Lines before the first numbered one are blank and stay folded.
function sidesOf(file: string, lines: DiffLine[]) {
  const kind = (l: DiffLine) => l.kind ?? "context";
  let oldStart = 1;
  let newStart = 1;
  let olds = 0;
  let news = 0;
  for (const l of lines) {
    const k = kind(l);
    if (k === "context" && l.number !== undefined) {
      newStart = l.number - news;
      oldStart = (l.old ?? l.number) - olds;
      break;
    }
    if (k === "removed" && l.number !== undefined && olds === 0) oldStart = l.number;
    if (k === "added" && l.number !== undefined && news === 0) newStart = l.number;
    if (k !== "added") olds += 1;
    if (k !== "removed") news += 1;
  }
  const before = (n: number) => Array.from({ length: Math.max(0, n - 1) }, () => "");
  const old = [...before(oldStart), ...lines.filter((l) => kind(l) !== "added").map((l) => l.text)];
  const now = [...before(newStart), ...lines.filter((l) => kind(l) !== "removed").map((l) => l.text)];
  // The blank lines that place the hunk are not the file's: the context shown stops at the lines given.
  const leading = lines.findIndex((l) => kind(l) !== "context");
  const padded = oldStart > 1 || newStart > 1;
  const options = padded && leading >= 0 ? { context: leading } : undefined;
  return {
    fileDiff: parseDiffFromFile({ name: file, contents: old.join("\n") + "\n" }, { name: file, contents: now.join("\n") + "\n" }, options),
    last: Math.max(old.length, now.length),
  };
}

function CodeHead({ title, detail, trailing, start }: { title: string; detail?: string; trailing?: ReactNode; start: number }) {
  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-2 pr-4" style={{ paddingLeft: start }}>
        <span className="truncate text-[13px] font-medium text-ink">{title}</span>
        {detail && <span className="shrink-0 text-[12.5px] whitespace-nowrap text-tertiary">{detail}</span>}
        <span className="flex-1" />
        {trailing}
      </div>
      <Rule />
    </>
  );
}

// One file of a patch: its path and counts, then its lines. Unified, one column with − and + before the code;
// split, the old side on the left and the new on the right, a removed run facing the added run that replaced it.
// Without `added` and `removed`, the counts are the diff's own. `numbers: false` leaves the line numbers out, for lines
// whose place in the file is not known (an edit's old and new text); `inset` is then where the code starts.
export function DiffBlock({
  file, added: givenAdded, removed: givenRemoved, lines, layout = "unified", fill = palette.quiet, numbers = true, inset = 16,
}: { file: string; added?: number; removed?: number; lines: DiffLine[]; layout?: "unified" | "split"; fill?: string; numbers?: boolean; inset?: number }) {
  const dark = useDark();
  const { fileDiff, n } = useMemo(() => {
    const sides = sidesOf(file, lines);
    return { fileDiff: sides.fileDiff, n: digits(sides.last) };
  }, [file, lines]);
  const added = givenAdded ?? (fileDiff?.hunks ?? []).reduce((sum, h) => sum + h.additionLines, 0);
  const removed = givenRemoved ?? (fileDiff?.hunks ?? []).reduce((sum, h) => sum + h.deletionLines, 0);
  const start = numbers ? codeStart(n) : inset;
  return (
    <div className="flex w-full flex-col overflow-hidden rounded-block" style={{ background: fill, ...edge(alpha(palette.ink, 0.03)) }}>
      {fileDiff && (
        // The header goes through the library's custom header slot: with its header disabled, a diff holding removed
        // lines never draws (@pierre/diffs 1.5.1).
        <FileDiff
          fileDiff={fileDiff}
          disableWorkerPool
          renderCustomHeader={() => (
            <CodeHead
              title={file}
              start={start}
              trailing={
                <span className="flex shrink-0 gap-2 font-mono text-[12px]">
                  <span className="text-green-ink">+{added}</span>
                  {removed > 0 && <span className="text-red-ink">−{removed}</span>}
                </span>
              }
            />
          )}
          style={codeType}
          options={{ theme: codeTheme(dark), themeType: dark ? "dark" : "light", diffStyle: layout, disableLineNumbers: !numbers, overflow: "scroll" }}
        />
      )}
    </div>
  );
}

// A file's text, highlighted, with its line numbers: one header line (the path, then its size), a rule, then the
// code on the header's left edge. Long lines scroll sideways.
export function FileViewer({ path, detail, text, className }: { path: string; detail?: string; text: string; className?: string }) {
  const n = digits(text.split("\n").length);
  return (
    <div className={cn("flex h-full w-full flex-col bg-page", className)}>
      <CodeHead title={path} detail={detail} start={codeStart(n)} />
      <div className="min-h-0 flex-1 overflow-auto">
        <Highlighted name={path} text={text} />
      </div>
    </div>
  );
}

export type TerminalLine = { prompt?: string; text: string; tone?: Tone };

function lineInk(line: TerminalLine) {
  return line.tone ? tones[line.tone].ink : line.prompt === undefined ? palette.secondary : palette.ink;
}

// A line wider than the block scrolls inside it.
export function TerminalBlock({ lines, fill = palette.area }: { lines: TerminalLine[]; fill?: string }) {
  return (
    <div className="flex w-full flex-col items-start overflow-x-auto rounded-block px-[18px] py-4" style={{ background: fill }}>
      {lines.map((line, i) => (
        <div key={i} className="flex h-[22px] items-center gap-1.5 font-mono text-[12px] whitespace-pre">
          {line.prompt !== undefined && <span className="text-tertiary">{line.prompt}</span>}
          <span style={{ color: lineInk(line) }}>{line.text}</span>
        </div>
      ))}
    </div>
  );
}

// The link's state. `refused`: the machine cannot start, with the reason.
export type LiveTerminalStatus = "connecting" | "starting" | "live" | "closed" | { refused: string };

const statusWord = (s: LiveTerminalStatus): [string, Tone] =>
  typeof s === "object" ? ["Not started", "red"] : ({ connecting: ["Connecting", "blue"], starting: ["Starting the machine", "orange"], live: ["Connected", "green"], closed: ["Connection closed", "grey"] } as const)[s] as [string, Tone];

// A colour as a 24-bit ANSI foreground.
function ansi(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return `\x1b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
}

// A live shell on a machine: a bar with the link's state, the lines it printed, and a prompt that hands each
// line typed to `input` while connected. It never connects by itself: the app feeds the lines and the state.
export function LiveTerminal({
  state, lines = [], prompt = "$", input, reconnect, className,
}: { state: LiveTerminalStatus; lines?: TerminalLine[]; prompt?: string; input?: (line: string) => void; reconnect?: () => void; className?: string }) {
  const [word, tone] = statusWord(state);
  const refused = typeof state === "object" ? state.refused : undefined;
  const waiting = (state === "connecting" || state === "starting") && lines.length === 0;
  const held = useDelayedBusy(waiting, refused !== undefined);
  return (
    <div className={cn("flex h-full w-full flex-col bg-quiet", className)}>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
        <Glyph name="terminal" size={13} color={palette.tertiary} />
        <span className="text-[13px] font-medium text-ink">Shell</span>
        <span className="flex-1" />
        <Dot tone={tone} />
        <span className="text-[13px] text-secondary">{word}</span>
        {reconnect && state === "closed" && (
          <span className="pl-1">
            <Button size="small" onClick={reconnect}>
              Reconnect
            </Button>
          </span>
        )}
      </div>
      {refused !== undefined ? (
        <div className="flex min-h-0 flex-1 justify-center p-6">
          <div className="w-full" style={{ maxWidth: measure.page }}>
            <Notice text={refused} tone="red" title="The machine was not started" />
          </div>
        </div>
      ) : waiting || held ? (
        <div className="min-h-0 flex-1">
          <LoadingState text={word} />
        </div>
      ) : (
        <Screen lines={lines} live={state === "live"} prompt={prompt} input={input} />
      )}
    </div>
  );
}

// The lines in xterm: they start at the top; once they fill the pane, the latest stay in view. Live, the prompt
// takes what is typed and hands each line to `input`.
function Screen({ lines, live, prompt, input }: { lines: TerminalLine[]; live: boolean; prompt: string; input?: (line: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const send = useRef(input);
  send.current = input;
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let term: Terminal | undefined;
    let gone = false;
    let draft = "";
    const promptText = `${ansi(palette.tertiary)}${prompt}\x1b[0m `;
    const subscriptions: { dispose(): void }[] = [];
    void document.fonts.ready.then(() => {
      if (gone) return;
      term = new Terminal({
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontSize: 13,
        lineHeight: 1.29,
        letterSpacing: 0,
        cursorBlink: live,
        cursorStyle: "bar",
        cursorInactiveStyle: "none",
        disableStdin: !live,
        allowTransparency: true,
        scrollback: 5000,
        theme: {
          background: palette.quiet,
          foreground: palette.ink,
          cursor: live ? palette.ink : palette.quiet,
          selectionBackground: alpha(palette.ink, 0.12),
        },
      });
      // The pane's width in columns, its height in rows.
      const fit = () => {
        const core = (term as unknown as { _core: { _renderService: { dimensions: { css: { cell: { width: number; height: number } } } } } })._core;
        const cell = core._renderService.dimensions.css.cell;
        if (!cell.width || !cell.height) return;
        const cols = Math.max(2, Math.floor(el.clientWidth / cell.width));
        const rows = Math.max(1, Math.floor(el.clientHeight / cell.height));
        if (cols !== term!.cols || rows !== term!.rows) term!.resize(cols, rows);
      };
      term.open(el);
      fit();
      const out = lines.map((l) => (l.prompt !== undefined ? `${ansi(palette.tertiary)}${l.prompt}\x1b[0m ` : "") + `${ansi(lineInk(l))}${l.text}\x1b[0m`);
      term.write(out.join("\r\n") + (live ? (out.length ? "\r\n" : "") + promptText : ""));
      if (!live) term.write("\x1b[?25l");
      if (live) {
        term.focus();
        subscriptions.push(
          term.onData((data) => {
            for (const ch of data) {
              if (ch === "\r") {
                term!.write("\r\n");
                send.current?.(draft);
                draft = "";
                term!.write(promptText);
              } else if (ch === "\x7f") {
                if (draft) {
                  draft = draft.slice(0, -1);
                  term!.write("\b \b");
                }
              } else if (ch >= " ") {
                draft += ch;
                term!.write(`${ansi(palette.ink)}${ch}\x1b[0m`);
              }
            }
          }),
        );
      }
      const observer = new ResizeObserver(fit);
      observer.observe(el);
      subscriptions.push({ dispose: () => observer.disconnect() });
    });
    return () => {
      gone = true;
      subscriptions.forEach((s) => s.dispose());
      term?.dispose();
    };
  }, [lines, live, prompt]);
  return (
    // The lines start where the bar's title starts, past its glyph (16 + 13 + 8).
    <div className="min-h-0 flex-1 py-4 pr-[18px] pl-[37px]">
      <div ref={host} className="h-full w-full [&_.xterm-viewport]:bg-transparent!" />
    </div>
  );
}
