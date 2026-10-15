// A page split in two side by side: the main column on the left, a pane on the right, one divider between them that
// a drag, the arrow keys or a double click resize. Only the pane has a width; the main column takes the rest.
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { cn } from "./cn";
import { Clickable } from "./clickable";
import { Glyph } from "./glyph";
import { usePresence } from "./presence";
import { IconButton } from "./primitives";
import { palette } from "./tokens";

// The pane never narrows past `pane`, the main column never past `main`; a pane opens at `share` of the width.
export const splitLimits = { pane: 360, main: 420, share: 0.5, step: 16, stride: 32 } as const;

// The pane's width for a split `total` wide: `wanted` kept within both limits. When both cannot hold, the main
// column keeps its own and the pane gets what is left, never under its minimum.
export function clampPane(wanted: number, total: number) {
  const max = Math.max(splitLimits.pane, total - splitLimits.main - 1);
  return Math.round(Math.min(Math.max(wanted, splitLimits.pane), max));
}

// What resizes the pane while the divider moves, when the app drives it (a native view in the pane follows it frame
// by frame, see the app's place.ts). `drag` is told each width wanted and applies it through `apply` when the frame
// for it comes (`apply` lays the page out before it returns); `end` once the pointer lets go, after which the driver
// applies the last width wanted. Without a driver the split applies the latest width once per frame.
export type SplitDriver = {
  drag: (width: number, apply: (width: number) => void) => void;
  end: () => void;
};
export const SplitDrive = createContext<SplitDriver | null>(null);

const saved = "h0.split";

// The pane's width as last left, kept per viewer.
function stored(): number | undefined {
  try {
    const n = Number(localStorage.getItem(saved));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

function store(width: number | undefined) {
  try {
    if (width === undefined) localStorage.removeItem(saved);
    else localStorage.setItem(saved, String(Math.round(width)));
  } catch {
    // Kept when storage allows it.
  }
}

export type SplitProps = {
  // The main column (the conversation).
  children: ReactNode;
  // The pane; without one the main column takes the whole width.
  pane?: ReactNode;
  // A fixed starting width, for the gallery; otherwise the width last left, else half.
  width?: number;
  // Draws the divider as while dragged, for the gallery.
  dragging?: boolean;
  className?: string;
};

// The split: the main column, the divider, the pane. The divider is a line with a wider grip over the main column's
// edge (the pane may hold a native view, which takes every pointer event over it). While it is dragged the whole
// window shows the resize cursor and selects no text.
export function Split({ children, pane, width: given, dragging: drawn, className }: SplitProps) {
  const ref = useRef<HTMLDivElement>(null);
  const driver = useContext(SplitDrive);
  const [total, setTotal] = useState(0);
  // The width wanted, before the limits of the split as it stands.
  const [wanted, setWanted] = useState<number | undefined>(() => given ?? stored());
  const [dragging, setDragging] = useState(false);
  const open = pane !== undefined;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const read = () => setTotal(element.getBoundingClientRect().width);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const width = clampPane(wanted ?? total * splitLimits.share, total);
  // A drag in progress: where it started and the frame it waits on, when the split applies widths itself.
  const drag = useRef<{ x: number; from: number; frame?: number; next?: number } | null>(null);

  const apply = (w: number) => setWanted(w);
  // The driver reads the layout right after: the width is laid out at once.
  const applyNow = (w: number) => flushSync(() => setWanted(w));
  const want = (w: number) => {
    const next = clampPane(w, total);
    const d = drag.current;
    if (d) d.next = next;
    if (driver) return driver.drag(next, applyNow);
    if (!d) return apply(next);
    d.frame ??= requestAnimationFrame(() => {
      d.frame = undefined;
      if (d.next !== undefined) apply(d.next);
    });
  };
  const commit = (w: number | undefined) => store(w === undefined ? undefined : clampPane(w, total));

  useEffect(() => {
    if (!dragging) return;
    document.documentElement.classList.add("resizing");
    return () => document.documentElement.classList.remove("resizing");
  }, [dragging]);

  return (
    <div ref={ref} className={cn("relative flex min-h-0 min-w-0 flex-1", className)}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      {open && (
        <PaneRoot>
          <SplitHandle
            width={width}
            total={total}
            dragging={dragging || !!drawn}
            start={(x) => {
              drag.current = { x, from: width };
              setDragging(true);
            }}
            move={(x) => {
              const d = drag.current;
              if (d) want(d.from - (x - d.x));
            }}
            end={() => {
              const d = drag.current;
              if (!d) return;
              if (d.frame !== undefined) cancelAnimationFrame(d.frame);
              const last = d.next;
              drag.current = null;
              setDragging(false);
              driver?.end();
              if (!driver && last !== undefined) apply(last);
              commit(last ?? wanted);
            }}
            step={(by) => {
              const next = clampPane(width + by, total);
              apply(next);
              commit(next);
            }}
            reset={() => {
              setWanted(undefined);
              commit(undefined);
            }}
          />
          <div data-split-pane className="presence-panel presence-drawer relative flex min-h-0 shrink-0 flex-col bg-page" style={{ width }}>
            {pane}
          </div>
        </PaneRoot>
      )}
    </div>
  );
}

// The divider and the pane as one part, so they leave together: over the column, which has already taken their room.
function PaneRoot({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  usePresence(root);
  return (
    <div ref={root} className="presence-over contents">
      {children}
    </div>
  );
}

type HandleProps = {
  width: number;
  total: number;
  dragging: boolean;
  start: (x: number) => void;
  move: (x: number) => void;
  end: () => void;
  step: (by: number) => void;
  reset: () => void;
};

// The divider: a one-point line on the pane's left edge, and a grip 9 points wide that reaches over the main
// column. Hovered (after a short rest) or dragged, the line thickens in ink. Focused, the arrows move it a step
// (a stride with Shift); a double click puts it back at half.
function SplitHandle({ width, total, dragging, start, move, end, step, reset }: HandleProps) {
  const held = useRef(false);
  const release = () => {
    if (!held.current) return;
    held.current = false;
    end();
  };
  return (
    <div className="relative z-10 w-px shrink-0 bg-line">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the pane"
        aria-valuenow={Math.round(width)}
        aria-valuemin={splitLimits.pane}
        aria-valuemax={Math.max(splitLimits.pane, Math.round(total - splitLimits.main))}
        tabIndex={0}
        data-testid="separator:Pane"
        data-dragging={dragging || undefined}
        className="group absolute inset-y-0 -left-2 w-[9px] cursor-col-resize touch-none outline-none select-none"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          // Captured, the moves keep coming here wherever the pointer goes, over the pane's native view too.
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // A pointer the window does not track (a synthetic one) moves over the grip only.
          }
          e.currentTarget.focus({ preventScroll: true });
          held.current = true;
          start(e.clientX);
        }}
        onPointerMove={(e) => {
          if (held.current) move(e.clientX);
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          release();
        }}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onDoubleClick={reset}
        onKeyDown={(e) => {
          const by = e.shiftKey ? splitLimits.stride : splitLimits.step;
          // The pane grows to the left: the left arrow widens it.
          if (e.key === "ArrowLeft") step(by);
          else if (e.key === "ArrowRight") step(-by);
          else if (e.key === "Home") step(total);
          else if (e.key === "End") step(-total);
          else if (e.key === "Enter") reset();
          else return;
          e.preventDefault();
        }}
      >
        <span
          className={cn(
            "pointer-events-none absolute inset-y-0 right-0 w-[3px] bg-transparent transition-colors duration-150",
            "group-hover:bg-faint group-hover:delay-300 group-focus-visible:bg-faint",
            dragging && "bg-faint! delay-0!",
          )}
        />
      </div>
    </div>
  );
}

// One tab of the pane: what it is called, its glyph and what it shows. `site` says the content holds a native view.
export type PaneTab = { key: string; title: string; glyph: string; content: ReactNode };

export type PaneProps = {
  tabs: PaneTab[];
  active: string;
  choose: (key: string) => void;
  // Closes one tab; the last one closed closes the pane.
  close: (key: string) => void;
  // Closes the pane with its tabs.
  hide: () => void;
};

// The pane: the active tab's content, and under it the tabs, one per thing shown, with the pane's close at the end.
// Every tab's content stays mounted only while it is active.
export function Pane({ tabs, active, choose, close, hide }: PaneProps) {
  const shown = tabs.find((t) => t.key === active) ?? tabs[0];
  return (
    <div data-testid="pane:Pane" className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col">{shown?.content}</div>
      <PaneTabs tabs={tabs} active={shown?.key} choose={choose} close={close} hide={hide} />
    </div>
  );
}

// The pane's tab bar, at its foot: a line over it, tabs as in a strip (the active one filled), the pane's close
// at the right end.
export function PaneTabs({ tabs, active, choose, close, hide }: { tabs: PaneTab[]; active?: string; choose: (key: string) => void; close: (key: string) => void; hide: () => void }) {
  return (
    <div role="tablist" aria-label="Pane" className="relative flex h-11 shrink-0 items-center gap-1 border-t border-line px-2 [--click-fill:var(--color-quiet)]">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {tabs.map((tab) => (
          <PaneTabFace key={tab.key} tab={tab} on={tab.key === active} choose={() => choose(tab.key)} close={() => close(tab.key)} />
        ))}
      </div>
      <IconButton glyph="close" label="Close the pane" onClick={hide} />
    </div>
  );
}

function PaneTabFace({ tab, on, choose, close }: { tab: PaneTab; on: boolean; choose: () => void; close: () => void }) {
  return (
    <div role="tab" aria-selected={on} className="group/tab relative flex min-w-[96px] flex-[0_1_200px]">
      <Clickable
        fill={on ? palette.area : undefined}
        active={on}
        radius={6}
        onClick={choose}
        label={tab.title}
        handle={`panetab:${tab.title}`}
        chosen={on}
        className="flex h-8 min-w-0 flex-1 items-center gap-2 pr-7 pl-2.5"
      >
        <Glyph name={tab.glyph} size={12} color={on ? palette.secondary : palette.tertiary} width={1.4} />
        <span className={cn("min-w-0 flex-1 truncate text-[13px]", on ? "text-ink" : "text-secondary")}>{tab.title}</span>
      </Clickable>
      <Clickable
        fill={palette.pressed}
        onClick={close}
        label={`Close ${tab.title}`}
        handle={`button:Close ${tab.title}`}
        className={cn("absolute top-[7px] right-1.5 flex size-[18px] items-center justify-center", !on && "opacity-0 group-hover/tab:opacity-100")}
      >
        <Glyph name="close" size={10} color={palette.tertiary} width={1.6} />
      </Clickable>
    </div>
  );
}
