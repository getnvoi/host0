import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as PressEvent, type RefObject } from "react";
import { flushSync } from "react-dom";
import { cn } from "./cn";
import { Clickable } from "./clickable";
import { dragDistance } from "./sortable";
import { Glyph } from "./glyph";
import { alpha, Dot } from "./primitives";
import { palette, type Tone } from "./tokens";

// `tone` with `state`: a session tab that needs a look, as a dot and its words (the colour is never the only signal).
export type TabInfo = { title: string; tone?: Tone; state?: string; glyph?: string };

// The strip's height; the window's traffic lights sit in it, centred with the tabs 22.5 points from the top.
export const strip = 40;

// A tab's outline: rounded top corners and inverse curves at the foot so it flows into the body, at any width.
// `flush`: the tab stands on the body's left edge, so its left side runs straight down into the body's border.
function TabShape({ r = 8, flush }: { r?: number; flush?: boolean }) {
  const h = 35;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0" style={{ height: h }}>
      <div className="absolute inset-0 bg-page" style={{ borderTopLeftRadius: r, borderTopRightRadius: r }} />
      {flush ? (
        <svg className="absolute top-0 left-0 overflow-visible" width={r} height={h} viewBox={`0 0 ${r} ${h}`}>
          <path d={`M 0.5 ${h} L 0.5 ${r} Q 0.5 0.5 ${r} 0.5`} fill="none" stroke="var(--color-line)" strokeWidth={1} />
        </svg>
      ) : (
        <svg className="absolute bottom-0" style={{ left: -r }} width={r} height={r} viewBox={`0 0 ${r} ${r}`}>
          <path d={`M 0 ${r} Q ${r} ${r} ${r} 0 L ${r} ${r} Z`} fill="var(--color-page)" />
        </svg>
      )}
      <svg className="absolute bottom-0" style={{ right: -r }} width={r} height={r} viewBox={`0 0 ${r} ${r}`}>
        <path d={`M ${r} ${r} Q 0 ${r} 0 0 L 0 ${r} Z`} fill="var(--color-page)" />
      </svg>
    </div>
  );
}

function Separator({ visible }: { visible: boolean }) {
  return <div className="mb-[9.5px] h-4 w-px shrink-0" style={{ background: visible ? "var(--color-separator)" : "transparent" }} />;
}

// A square of the strip's corner, full height; a step darker under the pointer. Its left edge is engraved, a darker
// line then a lighter one, so the corner reads as set into the strip.
function StripCorner({ glyph, label, handle, onClick }: { glyph: string; label: string; handle?: string; onClick?: () => void }) {
  return (
    <Clickable fill="clear" onClick={onClick} label={label} handle={`button:${handle ?? label}`} className="flex">
      <span
        className="flex w-11 items-center justify-center hovering:bg-ink/6"
        style={{ boxShadow: `inset 1px 0 0 ${alpha(palette.ink, 0.09)}, inset 2px 0 0 ${alpha(palette.page, 0.55)}` }}
      >
        <Glyph name={glyph} size={15} color={palette.secondary} width={1.6} />
      </span>
    </Clickable>
  );
}

export type TabStripProps = {
  tabs: TabInfo[];
  active: number;
  // Draws the traffic lights, for the gallery; the app's window has its own.
  lights?: boolean;
  onSelect?: (i: number) => void;
  // The + after the tabs: a new tab on Home.
  onPlus?: () => void;
  // The ⋮ in the corner: the commander.
  onMore?: () => void;
  onClose?: (i: number) => void;
  // A tab dragged along the strip is dropped at another place: the tab at `from` now stands at `to`.
  onMove?: (from: number, to: number) => void;
  // The first tab stands on the body's left edge (the sidebar is open).
  flush?: boolean;
  // Draws the tab at `index` held `offset` points from its place, for the gallery.
  drag?: TabDrag;
  className?: string;
};

export type TabDrag = { index: number; offset: number };

// The window's tab strip, Chrome-style: tabs 200 points wide that narrow when the strip runs out of room, separators between inactive ones, the active tab
// continuous with the body, a detached +. Its empty parts drag the window; a tab never does. A tab dragged sideways slides along the strip and its neighbours step aside.
export function TabStrip({
  tabs, active, lights = true, onSelect, onPlus, onMore, onClose, onMove, flush, drag, className, style,
}: TabStripProps & { style?: CSSProperties }) {
  const strip = useRef<HTMLDivElement>(null);
  const reorder = useReorder(strip, tabs.length, onMove, drag);
  const { press, swallow } = reorder;
  // A tab opened or closed during a drag ends what the drag shows; its release then changes nothing.
  const held = reorder.held?.rects.length === tabs.length ? reorder.held : null;
  return (
    <div ref={strip} data-drag className={cn("flex h-10 w-full items-end bg-frame [--click-fill:var(--color-frame-pressed)]", className)} style={style}>
      {lights && (
        <div className="mr-6 mb-[11.5px] ml-4 flex gap-2">
          <span className="size-3 rounded-full bg-[#ee6a5f]" />
          <span className="size-3 rounded-full bg-[#f5bf4f]" />
          <span className="size-3 rounded-full bg-[#61c554]" />
        </div>
      )}
      {tabs.map((tab, i) => (
        <Fragment key={i}>
          <Tab
            tab={tab}
            on={i === active}
            flush={flush && (held ? first(held, i) : i === 0)}
            motion={held && motion(held, i)}
            held={held?.from === i}
            press={(e) => press(e, i)}
            swallow={swallow}
            select={() => onSelect?.(i)}
            close={tabs.length > 1 ? () => onClose?.(i) : undefined}
          />
          {i < tabs.length - 1 && <Separator visible={!held && i !== active && i + 1 !== active} />}
        </Fragment>
      ))}
      <div className="w-2 shrink-0" />
      <Separator visible />
      <Clickable fill="clear" onClick={onPlus} label="New tab" handle="button:New tab" className="mb-[3.5px] ml-2 flex transition-[scale] duration-[120ms] ease-out pressing:scale-[0.97]">
        <span className="relative flex size-7 items-center justify-center rounded-control bg-frame-pressed">
          <Glyph name="plus" size={15} color={palette.secondary} width={1.6} />
          {/* One step darker under the pointer. */}
          <span className="absolute inset-0 hidden rounded-control bg-ink/6 hovering:block" />
        </span>
      </Clickable>
      <div className="min-w-2 flex-1 self-stretch" />
      {/* The window's corner: the commander, full height on a darker fill. */}
      {onMore && (
        <div className="flex shrink-0 self-stretch bg-frame-pressed">
          <StripCorner glyph="moreVertical" label="Commander" onClick={onMore} />
        </div>
      )}
    </div>
  );
}

// A tab being dragged: where it was (`from`), where it would drop (`to`), how far it is from its place (`dx`), the
// tabs' rects when it was pressed. `settling`: released, sliding into its new place before the order changes.
type Held = { from: number; to: number; dx: number; rects: DOMRect[]; settling?: boolean };

// How long neighbours take to step aside, and the dropped tab to settle.
const slide = 150;
// How far above or below the strip the pointer may go before the tab goes back to its place.
const reach = strip;

// How far the tab at `i` stands from its place while `held` is dragged.
function offset(held: Held, i: number) {
  const { from, to, rects } = held;
  if (i === from) return held.dx;
  const step = rects[from].width + gap(rects);
  if (from < to && i > from && i <= to) return -step;
  if (to < from && i >= to && i < from) return step;
  return 0;
}

function gap(rects: DOMRect[]) {
  return rects.length > 1 ? rects[1].left - rects[0].right : 0;
}

// Whether the tab at `i` shows in the first place while `held` is dragged.
function first(held: Held, i: number) {
  return Math.abs(held.rects[i].left + offset(held, i) - held.rects[0].left) < 1;
}

// Where the held tab drops when it stands `dx` from its place: after every other tab whose middle it has reached
// (a tab to its right) or passed (a tab to its left), so either end of the strip is reached exactly.
function target(rects: DOMRect[], from: number, dx: number) {
  const middle = rects[from].left + rects[from].width / 2 + dx;
  return rects.filter((r, j) => (j < from ? r.left + r.width / 2 < middle : j > from && r.left + r.width / 2 <= middle)).length;
}

// The released tab's offset at its new place.
function landing(rects: DOMRect[], from: number, to: number) {
  return to > from ? rects[to].right - rects[from].right : rects[to].left - rects[from].left;
}

function motion(held: Held, i: number): CSSProperties {
  const quiet = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const moving = i !== held.from || held.settling;
  return {
    transform: `translateX(${offset(held, i)}px)`,
    transition: moving && !quiet ? `transform ${slide}ms var(--ease-enter)` : "none",
    zIndex: i === held.from ? 2 : undefined,
  };
}

// The strip's drag: a press on a tab past `dragDistance` holds it; it follows the pointer sideways, clamped between the
// first and last tab, its neighbours step aside with a transition. Released, it settles in its place, then
// `onMove` reorders. Escape, a cancelled pointer, or a release more than `reach` above or below the strip puts it
// back. Studied from Poolside's tab bar.
function useReorder(strip: RefObject<HTMLDivElement | null>, count: number, onMove: TabStripProps["onMove"], drag?: TabDrag) {
  const [held, setHeld] = useState<Held | null>(null);
  const moved = useRef(onMove);
  moved.current = onMove;
  const tabs = useRef(count);
  tabs.current = count;
  // Set from a drag's start until the click that ends its press has passed.
  const swallow = useRef(false);
  const stop = useRef<() => void>(undefined);
  useEffect(() => () => stop.current?.(), []);

  const rects = () => [...(strip.current?.querySelectorAll<HTMLElement>("[data-tab]") ?? [])].map((el) => el.getBoundingClientRect());

  // The gallery's held tab.
  useLayoutEffect(() => {
    if (!drag) return;
    const r = rects();
    if (!r[drag.index]) return;
    const dx = clamp(r, drag.index, drag.offset);
    setHeld({ from: drag.index, to: target(r, drag.index, dx), dx, rects: r });
  }, [drag?.index, drag?.offset, count]);

  function press(e: PressEvent<HTMLDivElement>, index: number) {
    if (e.button !== 0 || !moved.current || count < 2 || held || stop.current) return;
    if ((e.target as Element).closest("[data-close]")) return;
    const tab = e.currentTarget;
    const start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    const r = rects();
    const bounds = strip.current!.getBoundingClientRect();
    let now: Held | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const show = (next: Held | null) => {
      now = next;
      setHeld(next);
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== start.id || now?.settling) return;
      const dx = ev.clientX - start.x;
      if (!now && Math.hypot(dx, ev.clientY - start.y) < dragDistance) return;
      if (!now) {
        swallow.current = true;
        try {
          tab.setPointerCapture(start.id);
        } catch {
          // The pointer is already gone; its pointerup ends the drag.
        }
      }
      ev.preventDefault();
      const out = ev.clientY < bounds.top - reach || ev.clientY > bounds.bottom + reach;
      const x = out ? 0 : clamp(r, index, dx);
      show({ from: index, to: out ? index : target(r, index, x), dx: x, rects: r });
    };
    // The drag is over once the pointer is released and the tab has settled, in either order: Escape settles the
    // tab while the button is still down, and the click that ends that press must still be swallowed.
    let released = false;
    let settled = false;
    const settle = (to: number) => {
      if (!now || now.settling) return;
      const from = now.from;
      show({ ...now, to, dx: to === from ? 0 : landing(r, from, to), settling: true });
      timer = setTimeout(() => {
        flushSync(() => {
          setHeld(null);
          if (to !== from && tabs.current === r.length) moved.current?.(from, to);
        });
        settled = true;
        if (released) end();
      }, slide);
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== start.id) return;
      released = true;
      if (!now) return end();
      ev.preventDefault();
      settle(now.to);
      setTimeout(() => (swallow.current = false), 0);
      if (settled) end();
    };
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId !== start.id) return;
      released = true;
      swallow.current = false;
      if (!now) return end();
      settle(now.from);
      if (settled) end();
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || !now || now.settling) return;
      ev.preventDefault();
      ev.stopPropagation();
      settle(now.from);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      stop.current = undefined;
    };
    stop.current = () => {
      clearTimeout(timer);
      end();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
  }

  return { held, press, swallow };
}

// A held tab's offset, kept between the first tab's left edge and the last one's right edge.
function clamp(rects: DOMRect[], from: number, dx: number) {
  const low = rects[0].left - rects[from].left;
  const high = rects[rects.length - 1].right - rects[from].right;
  return Math.min(Math.max(dx, low), high);
}

// `held`: dragged along the strip; an inactive tab then takes the strip's colour and its hover face, so the tabs it
// passes over do not show through.
function Tab({ tab, on, flush, motion, held, press, swallow, select, close }: {
  tab: TabInfo;
  on: boolean;
  flush?: boolean;
  motion?: CSSProperties | null;
  held?: boolean;
  press: (e: PressEvent<HTMLDivElement>) => void;
  swallow: { current: boolean };
  select: () => void;
  close?: () => void;
}) {
  return (
    <div
      data-tab
      className={cn("relative flex h-[35px] min-w-[96px] flex-[0_1_200px] flex-col justify-center px-1", on ? "z-[1]" : "z-0", held && !on && "rounded-t-[8px] bg-frame")}
      style={motion ?? undefined}
      onPointerDown={press}
      // A press on a tab never drags the window (main.tsx listens on the document).
      onMouseDown={(e) => e.stopPropagation()}
      onClickCapture={(e) => {
        if (!swallow.current) return;
        e.stopPropagation();
        swallow.current = false;
      }}
    >
      {on && <TabShape flush={flush} />}
      <Clickable
        fill={on ? "clear" : undefined}
        radius={6}
        onClick={select}
        label={tab.state ? `${tab.title}, ${tab.state}` : tab.title}
        title={tab.state ? `${tab.title}, ${tab.state}` : undefined}
        handle={`tab:${tab.title}`}
        chosen={on}
        active={held}
        className="flex h-8 items-center gap-2 pr-1 pl-2"
      >
        {tab.tone ? <Dot tone={tab.tone} /> : <Glyph name={tab.glyph ?? "globe"} size={12} color={palette.tertiary} width={1.2} />}
        <span className={cn("min-w-0 flex-1 truncate text-[13px]", on ? "text-ink" : "text-secondary")}>{tab.title}</span>
        <span className="size-[18px] shrink-0" />
      </Clickable>
      {/* The last tab has no close button: the window always shows a place. */}
      {close && <Clickable
        fill={on ? palette.area : undefined}
        onClick={close}
        label={`Close ${tab.title}`}
        handle={`button:Close ${tab.title}`}
        data-close
        className="absolute top-[8.5px] right-2 flex size-[18px] items-center justify-center after:absolute after:-inset-x-[3px] after:-inset-y-2 after:content-['']"
      >
        <Glyph name="close" size={10} color={palette.tertiary} width={1.6} />
      </Clickable>}
    </div>
  );
}
