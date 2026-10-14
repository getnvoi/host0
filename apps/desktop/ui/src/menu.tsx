import { createContext, useContext, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  autoUpdate, flip, FloatingPortal, offset, shift, size as fit, useClick, useDismiss, useFloating, useFocus, useHover, useInteractions,
  useRole, useTransitionStyles, type Placement,
} from "@floating-ui/react";
import { cn } from "./cn";
import { Clickable } from "./clickable";
import { useFloat } from "./floating";
import { byKeyboard } from "./gesture";
import { Glyph } from "./glyph";
import { useScrollLock } from "./scrolllock";
import { TextInput } from "./inputs";
import { EmptyState } from "./start";
import { Button, Count, GroupTitle, Item, Kbd, Radio, Rule, WorkspaceTile, type Lead } from "./primitives";
import { palette } from "./tokens";

// Where floating panels mount: a gallery stage that shows them in place. None: the document body.
export const FloatingLayer = createContext<HTMLElement | null>(null);

function Layer({ children }: { children: ReactNode }) {
  const root = useContext(FloatingLayer);
  return <FloatingPortal root={root ?? undefined}>{children}</FloatingPortal>;
}

export type MenuItem = {
  kind: "item";
  title: string;
  glyph?: string;
  workspace?: string;
  keys?: string[];
  count?: number;
  destructive?: boolean;
  disabled?: boolean;
  checked?: boolean;
  radio?: boolean;
  detail?: string;
  action?: () => void;
  // Icon buttons at the row's right end, each its own action; choosing one closes the menu like the row does.
  actions?: MenuAction[];
};

// A row's own button: a glyph saying what it does, its label as tooltip and handle (`button:<label>`).
export type MenuAction = { glyph: string; label: string; disabled?: boolean; action?: () => void };

// One line of a menu: an action, a header item, a group title or a divider.
export type MenuEntry =
  | MenuItem
  | { kind: "header"; title: string; sub: string; lead: Lead }
  | { kind: "title"; text: string }
  // What a menu says when it has nothing to choose: what is missing, and the way to get it.
  | { kind: "empty"; glyph: string; text: string; cta: string; run: () => void }
  | { kind: "divider" };

export const menu = {
  item: (title: string, options: Omit<MenuItem, "kind" | "title"> = {}): MenuEntry => ({ kind: "item", title, ...options }),
  header: (title: string, sub: string, lead: Lead): MenuEntry => ({ kind: "header", title, sub, lead }),
  title: (text: string): MenuEntry => ({ kind: "title", text }),
  empty: (glyph: string, text: string, cta: string, run: () => void): MenuEntry => ({ kind: "empty", glyph, text, cta, run }),
  divider: { kind: "divider" } as MenuEntry,
};

// The tallest a menu opens before its entries scroll. A workspace could tune it (issue #33).
const menuMaxHeight = 320;

// Menus stay inside the window's body: the tab strip above takes 48pt.
const menuInset = { top: 48, right: 8, bottom: 8, left: 8 };

export type MenuPanelProps = {
  entries: MenuEntry[];
  width?: number;
  // Past it the entries scroll; the search stays on top.
  maxHeight?: number;
  search?: boolean;
  close?: () => void;
  // Rows edge to edge on a surface's inset, without the panel's own face (shadow, corners, padding): the body of a
  // dialog. The rows' icons sit on the header's icon, their text on its text.
  flush?: boolean;
  className?: string;
};

// Destructive entries go last, after one divider, whatever order they were given in; dividers never double up or
// end the menu.
function ordered(entries: MenuEntry[]): MenuEntry[] {
  const destructive = entries.filter((e) => e.kind === "item" && e.destructive);
  const rest = entries.filter((e) => !(e.kind === "item" && e.destructive));
  const head: MenuEntry[] = [];
  for (const e of rest) if (e.kind !== "divider" || (head.length && head[head.length - 1].kind !== "divider")) head.push(e);
  if (head.length && head[head.length - 1].kind === "divider") head.pop();
  if (!destructive.length) return head;
  return head.length ? [...head, menu.divider, ...destructive] : destructive;
}

// Arrow keys move the focus through the entries that can be chosen: Up from the first goes back to the search; Right
// reaches a row's own buttons and Left comes back to the row. Home and End leave a text field alone.
function move(e: KeyboardEvent<HTMLDivElement>) {
  const panel = e.currentTarget;
  const target = e.target as HTMLElement;
  const typing = target instanceof HTMLInputElement;
  const items = [...panel.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')];
  const row = target.closest<HTMLElement>('[role="menuitem"]');
  const at = row ? items.indexOf(row) : -1;
  let next: HTMLElement | undefined;
  switch (e.key) {
    case "ArrowDown":
      next = items[at < 0 ? 0 : (at + 1) % items.length];
      break;
    case "ArrowUp": {
      const search = panel.querySelector<HTMLElement>("input");
      next = at > 0 ? items[at - 1] : search && at === 0 ? search : items[items.length - 1];
      break;
    }
    case "Home":
      if (!typing) next = items[0];
      break;
    case "End":
      if (!typing) next = items[items.length - 1];
      break;
    case "ArrowRight":
      if (row === target) next = row.querySelector<HTMLElement>('[role="button"]:not([aria-disabled="true"])') ?? undefined;
      break;
    case "ArrowLeft":
      if (row && row !== target) next = row;
      break;
  }
  if (!next) return;
  e.preventDefault();
  next.focus();
}

// The one menu: the account menu, dropdowns, selects and row actions all draw this panel.
export function MenuPanel({ entries: given, width, maxHeight, search, close = () => {}, flush, className }: MenuPanelProps) {
  const entries = ordered(given);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  // While searching, only matching actions show; titles and dividers drop out.
  const shown = q ? entries.filter((e) => e.kind === "item" && e.title.toLowerCase().includes(q)) : entries;
  const column = entries.some((e) => (e.kind === "item" && (e.glyph || e.workspace || e.radio)) || e.kind === "header");
  const first = () => {
    const item = shown.find((x): x is MenuItem => x.kind === "item" && !x.disabled);
    if (item) {
      item.action?.();
      close();
    }
  };
  return (
    <div
      role="menu"
      data-testid="menu:Menu"
      className={cn("flex flex-col items-stretch bg-page [--click-fill:var(--color-area)]", flush ? "min-h-0" : "overflow-hidden rounded-panel", className)}
      style={{ width, maxHeight, boxShadow: flush ? undefined : "var(--shadow-menu)" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") return close();
        // A menu under a control takes Tab as a way out; one in a dialog (flush) lets Tab move through it.
        if (e.key === "Tab" && !flush) {
          e.preventDefault();
          return close();
        }
        move(e);
      }}
    >
      {search && (
        // Fixed on top of the list: the field of the form's own small size, with its focus ring.
        <>
          <div className="shrink-0 p-2">
            <TextInput placeholder="Search" value={query} onChange={setQuery} glyph="search" size="small" autoFocus onSubmit={first} />
          </div>
          <Rule />
        </>
      )}
      {/* Entries keep their height: a long list scrolls, it never squeezes its rows. */}
      <div className={cn("flex min-h-0 flex-1 flex-col items-stretch [&>*]:shrink-0", !flush && "overflow-y-auto p-1.5")}>
      {search && shown.length === 0 && <span className="flex h-[34px] items-center px-2.5 text-[13px] text-tertiary">No match</span>}
      {shown.map((entry, i) => {
        switch (entry.kind) {
          case "item":
            return (
              <MenuRow
                key={i}
                item={entry}
                column={column || !!flush}
                flush={flush}
                run={(action = entry.action) => {
                  action?.();
                  close();
                }}
              />
            );
          case "header":
            return (
              <div key={i} className="px-2.5 py-2">
                <Item title={entry.title} line={{ sub: entry.sub }} lead={entry.lead} size="small" />
              </div>
            );
          case "title":
            return <GroupTitle key={i} title={entry.text} className={cn("pt-2 pb-1", column ? "pl-11" : "pl-2.5")} />;
          case "empty":
            return (
              <EmptyState
                key={i}
                size="small"
                glyph={entry.glyph}
                text={entry.text}
                action={
                  <Button size="mini" glyph={entry.glyph} onClick={() => { entry.run(); close(); }}>
                    {entry.cta}
                  </Button>
                }
              />
            );
          case "divider":
            return <Rule key={i} className="my-1.5" />;
        }
      })}
      </div>
    </div>
  );
}

function MenuRow({ item, column, flush, run }: { item: MenuItem; column: boolean; flush?: boolean; run: (action?: () => void) => void }) {
  const ink = item.disabled ? palette.faint : item.destructive ? "var(--color-red-ink)" : palette.ink;
  const mark = item.disabled ? palette.faint : item.destructive ? "var(--color-red-ink)" : palette.secondary;
  return (
    <Clickable
      fill={item.destructive ? "var(--color-red-fill)" : undefined}
      onClick={() => run()}
      disabled={item.disabled}
      label={item.title}
      handle={`menuitem:${item.title}`}
      chosen={item.checked}
      role="menuitem"
      tabIndex={-1}
      className={cn("flex items-center", flush ? "gap-3 px-5" : "gap-2.5 px-2.5", item.detail ? "h-11" : "h-[34px]")}
    >
      {column && (
        <span className={cn("flex shrink-0 items-center justify-center", flush ? "size-8" : "size-6")}>
          {item.radio ? <Radio on={!!item.checked} /> : item.workspace ? <WorkspaceTile name={item.workspace} /> : item.glyph ? <Glyph name={item.glyph} size={15} color={mark} /> : null}
        </span>
      )}
      <span className="flex min-w-0 flex-col gap-px">
        <span className="truncate text-[14px] font-medium" style={{ color: ink }}>
          {item.title}
        </span>
        {item.detail && <span className="truncate text-[12px] text-tertiary">{item.detail}</span>}
      </span>
      <span className="min-w-4 flex-1" />
      {item.keys && item.keys.length > 0 && (
        <span className="flex gap-0.5">
          {item.keys.map((k) => (
            <Kbd key={k} k={k} />
          ))}
        </span>
      )}
      {item.count !== undefined && <Count value={item.count} />}
      {item.checked && !item.radio && <Glyph name="check" size={12} color={palette.ink} width={2} />}
      {item.actions && item.actions.length > 0 && (
        // A step darker than the row's hover, so a button shows its own fill inside a hovered row.
        <span className="-mr-1.5 flex shrink-0 items-center gap-0.5">
          {item.actions.map((a) => (
            <Clickable
              key={a.label}
              fill={palette.pressed}
              onClick={() => run(a.action)}
              disabled={a.disabled}
              label={a.label}
              handle={`button:${a.label}`}
              title={a.label}
              tabIndex={-1}
              className="flex size-7 items-center justify-center"
            >
              <Glyph name={a.glyph} size={13} color={palette.secondary} width={1.6} />
            </Clickable>
          ))}
        </span>
      )}
    </Clickable>
  );
}

export type DropdownProps = {
  entries: MenuEntry[];
  edge?: "leading" | "trailing";
  above?: boolean;
  width?: number;
  // Sizes the panel to the control, as selects do.
  match?: boolean;
  search?: boolean;
  // The control's hover and open fill; "clear" for a label with its own face.
  fill?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  label: (open: boolean) => ReactNode;
  // The control's test id (`button:Workspace`).
  handle?: string;
  className?: string;
};

// A short line about what it wraps, on a small ink panel: shown after the pointer rests 400ms or on focus, gone when
// the pointer leaves, on Esc or a click. It does not count as floating: a website drawn above the page stays. `open`
// shows it from the start, for the gallery.
export function Tooltip({ text, side = "top", open: shown = false, children, className }: { text: string; side?: "top" | "bottom"; open?: boolean; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(shown);
  const { refs, floatingStyles, context, isPositioned } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: side,
    whileElementsMounted: autoUpdate,
    // Placed by top and left, shown once positioned: it opens in place, without motion.
    transform: false,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { delay: { open: 400, close: 0 } }),
    useFocus(context),
    useDismiss(context),
    useRole(context, { role: "tooltip" }),
  ]);
  return (
    <>
      <span ref={refs.setReference} {...getReferenceProps()} className={cn("inline-flex min-w-0", className)}>
        {children}
      </span>
      {open && (
        <Layer>
          <div
            ref={refs.setFloating}
            data-testid={`tooltip:${text}`}
            style={{ ...floatingStyles, zIndex: 60, visibility: isPositioned ? undefined : "hidden" }}
            {...getFloatingProps()}
            className="pointer-events-none max-w-64 rounded-control bg-ink px-2 py-1 text-[12px] leading-4 font-medium text-on-solid"
          >
            {text}
          </div>
        </Layer>
      )}
    </>
  );
}

// How long a dropdown takes to show and to leave, and the size it starts from. A workspace could tune them (issue #33).
const MENU_OPEN = 140;
const MENU_CLOSE = 90;
const MENU_SCALE = 0.96;

// A control that opens the menu panel under it. A click outside, Esc or a choice closes it.
export function Dropdown({ entries, edge: side = "leading", above, width, match, search, fill, open: external, onOpenChange, label, handle, className }: DropdownProps) {
  const [internal, setInternal] = useState(false);
  const open = external ?? internal;
  const setOpen = (v: boolean) => {
    setInternal(v);
    onOpenChange?.(v);
  };
  const placement: Placement = `${above ? "top" : "bottom"}-${side === "trailing" ? "end" : "start"}`;
  const [controlWidth, setControlWidth] = useState(0);
  // The room left between the control and the window's edge: a longer menu scrolls inside it.
  const [room, setRoom] = useState<number>();
  const { refs, floatingStyles, context, isPositioned } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    // Placed by top and left, shown once positioned; the panel inside it carries the motion.
    transform: false,
    middleware: [
      offset(4),
      // The side with the room: it flips when the preferred one is too short, and shifts to stay in the body.
      flip({ padding: menuInset }),
      shift({ padding: menuInset }),
      fit({
        padding: menuInset,
        apply: ({ rects, availableHeight }) => {
          setControlWidth(rects.reference.width);
          setRoom(Math.floor(availableHeight));
        },
      }),
    ],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([useClick(context), useDismiss(context)]);
  // Whether a key opened it (Enter, Space or an arrow on the control), noted as it opens.
  const keyed = useRef(false);
  const was = useRef(open);
  if (open !== was.current) {
    was.current = open;
    if (open) keyed.current = byKeyboard();
  }
  // It grows from the control's edge and fades in, then fades out quicker than it came: a menu opened by a click
  // on a control is not a command palette, and a close that blinks reads as a glitch. Opened by a key, it shows at once.
  const { isMounted, styles: motion } = useTransitionStyles(context, {
    duration: { open: keyed.current ? 0 : MENU_OPEN, close: MENU_CLOSE },
    initial: keyed.current ? {} : { opacity: 0, transform: `scale(${MENU_SCALE})` },
    common: ({ side, placement }) => ({
      transformOrigin: `${side === "bottom" ? "top" : "bottom"} ${placement.endsWith("end") ? "right" : "left"}`,
      transitionTimingFunction: "var(--ease-dialog)",
    }),
  });
  useFloat(open);
  // The panel mounts after the control, in a portal: it locks once positioned.
  useScrollLock(refs.floating, open && isPositioned);
  // Focus goes into the menu once it shows (the chosen entry, else the first; a search takes it itself) and returns to
  // the control when the menu closes with nothing else holding it.
  useEffect(() => {
    if (!open || !isPositioned || search) return;
    const panel = refs.floating.current;
    const entry = panel?.querySelector<HTMLElement>('[role="menuitem"][aria-selected="true"]') ?? panel?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])');
    entry?.focus();
  }, [open, isPositioned, search, refs.floating]);
  const opened = useRef(false);
  useEffect(() => {
    if (open) {
      opened.current = true;
      return;
    }
    if (!opened.current) return;
    opened.current = false;
    const held = document.activeElement;
    if (!held || held === document.body) (refs.domReference.current as HTMLElement | null)?.querySelector<HTMLElement>('[role="button"]')?.focus({ preventScroll: true });
  }, [open, refs.domReference]);
  const panelWidth = width ?? (match && controlWidth > 0 ? Math.max(controlWidth, 200) : undefined);
  return (
    <>
      <div
        ref={refs.setReference}
        {...getReferenceProps({
          // The menu opens here; the row or card holding the control does not take the click.
          onClick: (e) => e.stopPropagation(),
          onKeyDown: (e) => {
            if (e.key !== "ArrowDown" || open) return;
            e.preventDefault();
            setOpen(true);
          },
        })}
        data-open={open || undefined}
        className={cn("inline-flex", className)}
      >
        <Clickable fill={fill} active={open} handle={handle} className="flex min-w-0 flex-1">
          {label(open)}
        </Clickable>
      </div>
      {isMounted && (
        <Layer>
          <div
            ref={refs.setFloating}
            style={{ ...floatingStyles, zIndex: 50, visibility: isPositioned ? undefined : "hidden", pointerEvents: open ? undefined : "none" }}
            {...getFloatingProps()}
          >
            <div style={motion}>
              <MenuPanel entries={entries} width={panelWidth} maxHeight={room === undefined ? menuMaxHeight : Math.min(room, menuMaxHeight)} search={search} close={() => setOpen(false)} />
            </div>
          </div>
        </Layer>
      )}
    </>
  );
}

// A menu drawn above an element that keeps the keyboard (a text field), with no control of its own: its owner opens it,
// closes it and moves through it. A press on it does not take the focus from the field.
export function AnchoredMenu({ anchor, entries, width = 300, close }: { anchor: HTMLElement | null; entries: MenuEntry[]; width?: number; close: () => void }) {
  const { refs, floatingStyles, isPositioned } = useFloating({
    elements: { reference: anchor },
    placement: "top-start",
    whileElementsMounted: autoUpdate,
    transform: false,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  useFloat(true);
  if (!anchor) return null;
  return (
    <Layer>
      <div
        ref={refs.setFloating}
        style={{ ...floatingStyles, zIndex: 50, visibility: isPositioned ? undefined : "hidden" }}
        onMouseDown={(e) => e.preventDefault()}
      >
        <MenuPanel entries={entries} width={width} maxHeight={320} close={close} />
      </div>
    </Layer>
  );
}

// Runs `handler` on Escape while mounted.
export function useEscape(handler: () => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const listen = (e: globalThis.KeyboardEvent) => e.key === "Escape" && ref.current();
    addEventListener("keydown", listen);
    return () => removeEventListener("keydown", listen);
  }, []);
}
