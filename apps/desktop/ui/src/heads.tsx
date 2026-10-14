import { createContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "./cn";
import { Backdrop, Clickable } from "./clickable";
import { useTrap } from "./floating";
import { AvatarStack } from "./avatars";
import { Glyph } from "./glyph";
import { slideText, useSlide } from "./slide";
import { usePresence } from "./presence";
import { useScrollLock } from "./scrolllock";
import { TextInput } from "./inputs";
import { Dropdown, menu, useEscape, type MenuEntry } from "./menu";
import { useNavigate } from "./screens/navigate";
import { EdgeRule, searchableBox, Surface } from "./surface";
import {
  alpha, Button, Count, edge, IconButton, Item, LeadView, Pill,
  type ItemLine, type ItemSize, type Lead, type Person, type TabStatus, tabStatus,
} from "./primitives";
import { measure, palette, toneEdge, tone as tones, type Tone } from "./tokens";

// The shadow of a panel floating over the window (dialogs, drawers).
const floating = "var(--shadow-menu)";

// Where the branch's pull request stands, as the head's button says it. `create` and `ship` ask the agent (off while
// nothing changed); `open` and `merged` link to it; `shipped` can ship again.
export type PullRequest =
  | { kind: "create" }
  | { kind: "open"; url: string }
  | { kind: "merged"; url: string }
  | { kind: "ship" }
  | { kind: "shipped" };

export type SessionHeadProps = {
  title: string;
  branch: string;
  changes: number;
  // Without one there is no button.
  pullRequest?: PullRequest | null;
  // Makes it a tab session's head: no machine, no tools.
  tab?: TabStatus;
  // The path it goes back to (the list of all sessions): the whole item is the button, and the mark turns into a back
  // arrow while hovered.
  back?: string;
  // Asks the agent to open the pull request or ship.
  request?: () => void;
  // Opens a pull request that exists.
  openLink?: (url: string) => void;
  // Opens a tool of the checkout in the large drawer: from the pull request's menu (files, changes) or the
  // machine's (terminal). Without it neither menu shows.
  tool?: (tool: SessionTool) => void;
  // The machine menu's entries above Terminal: the box's processes.
  processes?: MenuEntry[];
  // Called each time the machine menu opens, to read the box again.
  onMachine?: () => void;
  // A menu drawn open, for the gallery.
  menu?: "machine" | "tools";
  // The others in the session now: with one or more, their faces stack in the head's centre.
  people?: Person[];
};

// The tools of a checkout, each in the large drawer.
export type SessionTool = "files" | "changes" | "terminal";
export const sessionTools: Record<SessionTool, { title: string; glyph: string }> = {
  files: { title: "Files", glyph: "repo" },
  changes: { title: "Changes", glyph: "changes" },
  terminal: { title: "Terminal", glyph: "terminal" },
};

// A session's head: its item on the left; on the right the machine's menu, the pull request button and, under a
// chevron after it, the checkout's files and changes. It carries no state: a tab session's tab state shows in the
// composer's tray.
export function SessionHead({
  title, branch, changes, pullRequest = { kind: "create" }, tab, back, request = () => {}, openLink = () => {}, tool, processes = [], onMachine, menu: drawn, people = [],
}: SessionHeadProps) {
  const entry = (t: SessionTool) => menu.item(sessionTools[t].title, { glyph: sessionTools[t].glyph, action: () => tool?.(t) });
  const tools = !tab && tool;
  const navigate = useNavigate();
  return (
    <div data-testid="head:Session" className="relative flex h-14 items-center gap-3 px-4">
      {people.length > 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="pointer-events-auto flex">
            <AvatarStack people={people} size={24} limit={5} />
          </span>
        </div>
      )}
      <div className="flex min-w-0 flex-1">
        {(() => {
          // With a way back, the whole item is the button and its mark swaps for a left arrow while hovered.
          const lead: Lead = back ? { swap: { visual: "session", over: "arrowLeft" } } : { visual: "session" };
          const item = tab ? (
            <Item title={title} line={{ sub: tabStatus.place(tab) }} lead={lead} size="small" />
          ) : (
            <Item title={title} line={{ sub: branch }} lead={lead} size="small" monoSub />
          );
          return back ? (
            <Clickable bleed={8} onClick={() => navigate(back)} label="Back" handle="button:Back" className="flex min-w-0">
              {item}
            </Clickable>
          ) : (
            item
          );
        })()}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {tools && (
          <Dropdown
            edge="trailing"
            width={260}
            open={drawn === "machine" ? true : undefined}
            onOpenChange={(open) => open && onMachine?.()}
            entries={[...processes, menu.divider, entry("terminal")]}
            label={() => (
              <span aria-label="Machine" data-testid="button:Machine" className="flex size-8 items-center justify-center">
                <Glyph name="server" size={14} color={palette.secondary} width={1.6} />
              </span>
            )}
          />
        )}
        {tools && <span className="w-1" />}
        {pullRequest ? (
          <PullRequestMenu
            pr={pullRequest}
            changes={changes}
            request={request}
            openLink={openLink}
            tools={tools ? [entry("files"), entry("changes")] : []}
            open={drawn === "tools" ? true : undefined}
          />
        ) : (
          tools && (
            <Dropdown
              edge="trailing"
              width={240}
              fill="clear"
              open={drawn === "tools" ? true : undefined}
              entries={[entry("files"), entry("changes")]}
              label={() => (
                <Button size="small" chevron label="Files and changes">
                  Files
                </Button>
              )}
            />
          )
        )}
      </div>
      <EdgeRule />
    </div>
  );
}

// The pull request's button: one dropdown button, its label and the count of changed files with a chevron. Its menu
// holds the pull request's action first (`create` and `ship` ask the agent, off while nothing changed; `open` and
// `merged` link to it; `shipped` can ship again), then the checkout's tools.
function PullRequestMenu({ pr, changes, request, openLink, tools, open }: {
  pr: PullRequest; changes: number; request: () => void; openLink: (url: string) => void; tools: MenuEntry[]; open?: boolean;
}) {
  const count = changes > 0 ? changes : undefined;
  const face = {
    create: { title: "Create pull request", kind: "primary" },
    ship: { title: "Ship", kind: "primary" },
    shipped: { title: "Shipped", kind: "secondary" },
    open: { title: "Pull request", kind: "secondary" },
    merged: { title: "Merged", kind: "secondary" },
  }[pr.kind] as { title: string; kind: "primary" | "secondary" };
  const action: MenuEntry =
    pr.kind === "open" || pr.kind === "merged"
      ? menu.item(pr.kind === "open" ? "Open the pull request" : "Open the merged pull request", { glyph: "external", action: () => openLink(pr.url) })
      : menu.item(pr.kind === "create" ? "Create pull request" : pr.kind === "ship" ? "Ship" : "Ship again", {
          glyph: pr.kind === "create" ? "arrowUpRight" : "upload",
          count,
          disabled: changes === 0,
          action: request,
        });
  // A primary face only while its action can run; with nothing changed it is grey, with no glyph and no count, and
  // the menu stays open to the tools.
  const kind = face.kind === "primary" && changes === 0 ? "secondary" : face.kind;
  return (
    <span title={changes > 0 ? `${changes} ${changes === 1 ? "file" : "files"} changed` : undefined} className="inline-flex">
      <Dropdown
        edge="trailing"
        width={260}
        fill="clear"
        open={open}
        entries={[action, ...(tools.length ? [menu.divider, ...tools] : [])]}
        label={() => (
          <Button
            kind={kind}
            size="small"
            chevron
            glyph={pr.kind === "merged" || pr.kind === "shipped" ? "check" : undefined}
            label={face.title}
            count={pr.kind !== "merged" ? count : undefined}
          >
            {face.title}
          </Button>
        )}
      />
    </span>
  );
}

// A page head's mark and title. With a way back, the whole item is a button that goes back, its mark turning into an
// arrow while hovered; without one it is plain, with no hover.
export function HeadMark({ glyph, back, children }: { glyph: string; back?: string; children: ReactNode }) {
  const navigate = useNavigate();
  if (back) {
    return (
      <Clickable fill="clear" onClick={() => navigate(back)} label="Back" handle="button:Back" className="flex">
        <HeadMarkFace glyph={glyph} over="arrowLeft">
          {children}
        </HeadMarkFace>
      </Clickable>
    );
  }
  return <HeadMarkFace glyph={glyph}>{children}</HeadMarkFace>;
}

// `over`: another glyph that takes the mark's place while hovered (a back arrow).
export function HeadMarkFace({ glyph, over, children }: { glyph: string; over?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="relative inline-flex size-6 shrink-0">
        <span className={cn("inline-flex transition-opacity duration-[120ms] ease-out", over && "hovering:opacity-0")}>
          <LeadView lead={{ visual: glyph }} size={24} />
        </span>
        {over && (
          <span className="absolute inset-0 inline-flex items-center justify-center rounded-control bg-pressed opacity-0 transition-opacity duration-[120ms] ease-out hovering:opacity-100">
            <Glyph name={over} size={14} color={palette.ink} width={1.6} />
          </span>
        )}
      </span>
      {children}
    </div>
  );
}

export type PageHeadProps = {
  title: string;
  glyph: string;
  // Shown as a round count when it is a number.
  count?: string | number | null;
  // The body's width: the centre spans exactly the table or list below it. Full-width bodies pass `measure.search`.
  width?: number;
  // The path of the page it goes back to (its list): the whole head item is the button, and the mark turns into a back
  // arrow while hovered.
  back?: string;
  // The record's pill, last on the right after the actions.
  state?: [string, Tone];
  center?: ReactNode;
  action?: ReactNode;
};

// Over a list or settings page: the page's mark and title, search or filters in the centre, one action.
export function PageHead({ title, glyph, count, width = measure.page, back, state, center, action }: PageHeadProps) {
  const n = count === null || count === undefined || count === "" ? NaN : Number(count);
  // Three columns: the title keeps its natural width (16rem at most) and the actions keep theirs; the centre takes
  // the rest down to 10rem, its search narrowing first, then its segments scrolling. Only when the head is too narrow
  // for all three does the title ellipsize, down to 5rem. The side columns are as wide as the wider side, so the
  // centre stays on the body's edges.
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState(0);
  useLayoutEffect(() => {
    const sides = [left.current, right.current].filter((el): el is HTMLDivElement => !!el);
    const measureSides = () => setSide(Math.max(0, ...sides.map((el) => el.offsetWidth)));
    measureSides();
    const observer = new ResizeObserver(measureSides);
    sides.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
  return (
    <div
      data-testid={`head:${title}`}
      className="relative @container grid h-14 items-center gap-3 px-5"
      style={{ gridTemplateColumns: center ? `minmax(${side}px, 1fr) minmax(10rem, ${width}px) minmax(${side}px, 1fr)` : "minmax(0, 1fr) auto" }}
    >
      <div ref={left} className={cn("flex items-center gap-2.5", center ? "w-max" : "min-w-0")}>
        <HeadMark glyph={glyph} back={back}>
          <div className="flex min-w-0 items-center gap-2.5">
            <span className={cn("min-w-0 truncate font-display text-[15px] font-medium tracking-[-0.2px] whitespace-nowrap text-ink", center && "max-w-[16rem] @max-[40rem]:max-w-[5rem]")}>{title}</span>
            {Number.isInteger(n) && <Count value={n} />}
          </div>
        </HeadMark>
      </div>
      {/* It scrolls sideways when narrow, which clips: 4pt of room inside, taken back outside, keeps a focused field's halo. */}
      {center && <div className="-m-1 flex min-w-0 items-center overflow-x-auto p-1 [scrollbar-width:none] justify-center-safe">{center}</div>}
      <div ref={right} className="flex w-max shrink-0 items-center justify-self-end">
        {action}
        {state && (
          <span className="ml-1 inline-flex">
            <Pill text={state[0]} tone={state[1]} />
          </span>
        )}
      </div>
      <EdgeRule />
    </div>
  );
}

// Pages that share one place, as tabs on the head's line: the open one is inked; one bar on the line slides under it.
export function PageTabs({ items, selection, onChange }: { items: string[]; selection: number; onChange?: (i: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const line = useSlide(track, selection);
  return (
    <div ref={track} role="tablist" className="relative flex items-stretch gap-1 self-stretch">
      {items.map((item, i) => {
        const on = i === selection;
        return (
          <div key={item} className="relative flex items-center">
            <Clickable fill={palette.quiet} radius={6} onClick={() => onChange?.(i)} label={item} handle={`pagetab:${item}`} chosen={on} className="inline-flex h-8 items-center px-3">
              <span className={cn("text-[14px] font-medium", on ? "text-ink" : "text-secondary")} style={{ transition: slideText }}>{item}</span>
            </Clickable>
          </div>
        );
      })}
      {/* One underline on the head's bottom edge, under the chosen tab's title, sliding to the next choice. */}
      <span aria-hidden className="pointer-events-none absolute bottom-0 left-0 z-10 flex h-0.5 px-3" style={line}>
        <span className="h-full flex-1 bg-ink" />
      </span>
    </div>
  );
}

// The search in a page head: a small text input with the search glyph. `entries` is the size of the rows it
// filters, when they sit right below it: its text starts on theirs.
export function SearchField({
  placeholder, value = "", onChange, entries, loading,
}: { placeholder: string; value?: string; onChange?: (text: string) => void; entries?: ItemSize; loading?: boolean }) {
  return <TextInput placeholder={placeholder} value={value} onChange={onChange} onClear={() => onChange?.("")} loading={loading} glyph="search" size="small" entries={entries} className="min-w-32" />;
}

export type DrawerProps = {
  // A drawer headed by an item with its lead: the body starts on the item's text.
  title?: string;
  line?: ItemLine;
  lead?: Lead;
  // The item's trailing views (tags, a state).
  trailing?: ReactNode;
  // Any header, in place of the item.
  header?: ReactNode;
  // With `onExpand`, the drawer can grow to the whole window, keeping the same margin on every edge.
  expanded?: boolean;
  onExpand?: (expanded: boolean) => void;
  close?: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  // Dividers under the header and over the footer: by default while the body scrolls, so long content is not cut
  // against them unmarked; set to say otherwise.
  dividers?: boolean;
  // "large" holds a tool (files, changes, a terminal): wider, and its body is flush, laid out and scrolled by what it
  // holds.
  size?: "medium" | "large";
  // Content that grows at its end (a log streaming in): each change of `pin` scrolls to the bottom, unless the
  // person scrolled up; back at the bottom, it follows again.
  pin?: string | number;
};

// A drawer over the window: the scrim covers everything, the panel runs from the top of the window to its bottom with an
// 8pt margin on every side.
export function Drawer({ title, line, lead, trailing, header, expanded, onExpand, close = () => {}, children, footer, dividers, size = "medium", pin }: DrawerProps) {
  useEscape(close);
  const wide = !!expanded;
  const panel = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useTrap(panel);
  usePresence(root);
  useScrollLock(root);
  return (
    <div ref={root} className="fixed inset-0 z-30">
      <Backdrop close={close} />
      <Surface
        ref={panel}
        role="dialog"
        titleId={titleId}
        preset="drawer"
        testid="drawer:Drawer"
        className="absolute top-2 right-2 bottom-2 rounded-[12px] presence-panel presence-drawer transition-[width] duration-(--duration-drawer) ease-(--ease-panel)"
        style={{ width: wide ? "calc(100% - 16px)" : size === "large" ? measure.wide : measure.drawer, maxWidth: "calc(100% - 16px)", boxShadow: floating }}
        title={title}
        line={line}
        lead={lead}
        trailing={trailing}
        header={header}
        actions={onExpand && <IconButton glyph={wide ? "collapse" : "expand"} label={wide ? "Back to a drawer" : "Expand"} fill={palette.area} onClick={() => onExpand(!wide)} />}
        close={close}
        inset={size === "large" ? "flush" : "padded"}
        footer={footer}
        dividers={dividers}
        pin={pin}
      >
        {children}
      </Surface>
    </div>
  );
}

export type ConfirmDialogProps = {
  title: string;
  message: string;
  action: string;
  // Names what the action does (stop, link, key); a removal keeps the trash.
  glyph?: string;
  destructive?: boolean;
  loading?: boolean;
  confirm?: () => void;
  cancel?: () => void;
};

// Asks before an action that cannot be undone: what happens, what it touches, Cancel and the action. Esc and the
// scrim cancel; Return confirms.
export function ConfirmDialog({ title, message, action, glyph = "trash", destructive = true, loading, confirm = () => {}, cancel = () => {} }: ConfirmDialogProps) {
  useEscape(() => !loading && cancel());
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const messageId = useId();
  const root = useRef<HTMLDivElement>(null);
  useTrap(panel);
  usePresence(root);
  useScrollLock(root);
  useEffect(() => {
    const listen = (e: KeyboardEvent) => {
      // A focused button acts on its own: Enter on Cancel cancels.
      if (e.target instanceof Element && e.target.closest("button, [role=button]")) return;
      if (e.key === "Enter" && !loading) confirm();
    };
    addEventListener("keydown", listen);
    return () => removeEventListener("keydown", listen);
  }, [confirm, loading]);
  const red = tones.red;
  return (
    <div ref={root} className="fixed inset-0 z-40 flex items-center justify-center">
      <Backdrop close={cancel} />
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        tabIndex={-1}
        data-testid={`dialog:${title}`}
        className="relative flex w-[440px] flex-col rounded-[12px] bg-page outline-none presence-panel"
        style={{ boxShadow: `inset 0 0 0 1px ${alpha(palette.ink, 0.03)}, ${floating}` }}
      >
        <div className="flex items-start gap-3.5 p-5">
          <span
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-button"
            style={{ background: destructive ? red.fill : palette.area, ...edge(destructive ? alpha(red.ink, toneEdge) : alpha(palette.ink, 0.03)) }}
          >
            <Glyph name={glyph} size={17} color={destructive ? red.ink : palette.secondary} width={1.6} />
          </span>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span id={titleId} className="text-[15px] font-semibold text-ink [text-wrap:balance]">{title}</span>
            <span id={messageId} className="my-[-1.5px] text-[13px] leading-[20px] text-tertiary [text-wrap:pretty]">{message}</span>
          </div>
        </div>
        {/* A confirm's message never scrolls: no dividers (they come in pairs, only over a body that scrolls). */}
        <div className="relative flex items-center justify-end gap-2 px-5 pt-1 pb-5">
          <Button size="small" disabled={loading} onClick={cancel} handle="button:dismiss">
            Cancel
          </Button>
          <Button kind={destructive ? "danger" : "primary"} size="small" loading={loading} onClick={confirm} handle={`button:confirm-${action.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`}>
            {action}
          </Button>
        </div>
      </div>
    </div>
  );
}

export type DialogProps = {
  title: string;
  line?: ItemLine;
  glyph: string;
  close?: () => void;
  // Fixed under the header (a search); the body scrolls under it.
  strips?: ReactNode;
  // How the body is laid: the dialog's padding, rows edge to edge, or a tool edge to edge.
  inset?: "padded" | "rows" | "flush";
  children?: ReactNode;
  // The actions at the bottom; `false` for a dialog that has none (its close button is enough).
  footer?: ReactNode | false;
  // Dividers under the header and over the footer: by default while the body scrolls, so long content is not cut
  // against them unmarked; set to say otherwise.
  dividers?: boolean;
};

// A dialog in the middle of the window over the scrim: a surface with a header item, the content, actions at the
// bottom. It is as tall as its content, up to the window less a margin; past that its body scrolls.
export function Dialog({ title, line, glyph, close = () => {}, strips, inset = "padded", children, footer, dividers }: DialogProps) {
  useEscape(close);
  const panel = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useTrap(panel);
  usePresence(root);
  useScrollLock(root);
  return (
    <div ref={root} className="fixed inset-0 z-40 flex items-center justify-center">
      <Backdrop close={close} />
      <Surface
        ref={panel}
        role="dialog"
        titleId={titleId}
        preset="dialog"
        testid={`dialog:${title}`}
        className="relative rounded-[12px] presence-panel"
        // With a search the height is fixed: the list under it shrinking must not move the dialog.
        style={{ width: measure.dialog, ...(strips ? { height: searchableBox } : { maxHeight: "calc(100% - 64px)" }), boxShadow: `inset 0 0 0 1px ${alpha(palette.ink, 0.03)}, ${floating}` }}
        title={title}
        line={line}
        lead={{ visual: glyph }}
        close={close}
        strips={strips}
        inset={inset}
        // A dialog closes on a foot, with or without actions, unless it says it has none.
        footer={footer === false ? undefined : (footer ?? <></>)}
        dividers={dividers}
      >
        {children}
      </Surface>
    </div>
  );
}

// Titles of settings pages this person's role cannot open: the menus leave them out.
export const HiddenPages = createContext<readonly string[]>([]);

export const settingsGroups: [string, [string, string][]][] = [
  ["Workspace", [["Members", "people"], ["Roles", "gate"], ["Usage", "chart"], ["Billing", "card"], ["Agent settings", "bot"]]],
  ["Code", [["Repositories", "repo"], ["Environments", "terminal"], ["Connectors", "branch"]]],
  ["Account", [["Profile", "at"], ["Security", "lock"]]],
];

// How the branch changed a file, as a file list marks it.
export type FileChange = "added" | "modified" | "deleted";


export type NavRowProps = {
  title: string;
  glyph: string;
  count?: number;
  selected?: boolean;
  onClick?: () => void;
};

// A row of the sidebar: a glyph and a title; the selected one is white with a ring on the frame, the hover fill otherwise.
export function NavRow({ title, glyph, count, selected, onClick }: NavRowProps) {
  return (
    <Clickable
      fill={selected ? "clear" : undefined}
      onClick={onClick}
      label={title}
      handle={`nav:${title}`}
      chosen={!!selected}
      className={cn("flex h-8 items-center gap-2.5 rounded-control px-2.5", selected && "bg-page shadow-selected")}
    >
      <Glyph name={glyph} size={14} color={selected ? palette.ink : palette.tertiary} />
      <span className={cn("min-w-0 flex-1 truncate text-[14px]", selected ? "text-ink" : "text-secondary")}>{title}</span>
      {count ? <Count value={count} /> : null}
    </Clickable>
  );
}
