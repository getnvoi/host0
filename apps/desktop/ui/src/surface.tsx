import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEventHandler, type ReactNode, type Ref } from "react";
import { cn } from "./cn";
import { edge, IconButton, Item, Rule, type ItemLine, type Lead } from "./primitives";
import { measure, palette } from "./tokens";

// A line under a head or over a foot, laid over its edge so it takes no height.
export function EdgeRule({ top }: { top?: boolean }) {
  return <Rule className={cn("pointer-events-none absolute inset-x-0", top ? "top-0" : "bottom-0")} />;
}

// How far a body scrolls before its scroll to top button shows, and how long the scroll back takes. A workspace could
// tune both (issue #33).
const scrollTopAfter = 400;
const scrollTopMilliseconds = 220;

// The height of a surface with a search: fixed, whatever the search matches, so its edges and centre do not move while
// someone types. Never past the window less a margin. A workspace could tune it (issue #33).
const searchableHeight = 560;
export const searchableBox = `min(${searchableHeight}px, calc(100% - 64px))`;
// The same for a panel that sits in the window with no definite box around it (the commander): by the window's height.
export const searchableWindow = `min(${searchableHeight}px, calc(100vh - 192px))`;

// The one panel: a header, fixed strips (a search that stays while the list scrolls), a body that scrolls what is left,
// a footer. A dialog, a drawer, a page and a card (a board's lane) are all this, with their own sizes and place;
// nothing else draws a header, a body or a foot. It is always full bleed: it fills the room it is given edge to edge,
// and it imposes no height. In a column that has one (a dialog's max height, a drawer's, the window's), the body
// scrolls what remains after the header, strips and footer; without one it grows.
//
// THE SURFACE OWNS EVERY PADDING. Header, strips, body and footer share one inset, so the icon, a search, the rows and
// the actions land on the same edge; a caller passes its content bare and never pads it, so a page cannot have a top
// without a bottom. The body's `inset` says how it is laid:
//   padded    the preset's own padding; a dialog or drawer body starts on the header's left edge.
//   flush     no padding: a tool runs edge to edge and lays itself out.
//   rows      a list of rows edge to edge, with room above the first and below the last; the rows sit on the same inset.
//   centered  a column `column` wide in the middle of the body, with the page's padding on all four sides.
//   gutter    the body filled by one thing (an empty state), the same gutter on every side; it does not scroll.
// `scroll={false}`: the body holds what scrolls itself (a table, a board) and only gives it the room.
export type SurfaceProps = {
  preset: "dialog" | "drawer" | "page" | "card";
  testid?: string;
  className?: string;
  style?: CSSProperties;
  // The header: an item (`title`, `lead`), or any `header`; `actions` sit before the close button. A page brings its
  // own head, drawn as it is.
  title?: string;
  line?: ItemLine;
  lead?: Lead;
  trailing?: ReactNode;
  header?: ReactNode;
  actions?: ReactNode;
  // The close button; without it the surface has none (a palette that Esc and the scrim dismiss).
  close?: () => void;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  // A surface that is a dialog or a drawer says so: its role, and the id its title carries as its name. It can take the
  // focus.
  ref?: Ref<HTMLDivElement>;
  role?: "dialog" | "alertdialog";
  titleId?: string;
  // Fixed under the header, over the body: they do not scroll.
  strips?: ReactNode;
  inset?: "padded" | "flush" | "rows" | "centered" | "gutter";
  // The width of a centered column.
  column?: number;
  scroll?: boolean;
  // A soft grey button at the body's bottom right takes it back to the top once it has scrolled a screen or so.
  scrollTop?: boolean;
  footer?: ReactNode;
  // Dividers under the header and over the footer. The strong default, not a rule: a drawer has them; a dialog has the
  // two together while its body scrolls, so long content is not cut against an unmarked edge, and none while it fits.
  dividers?: boolean;
  // A thinner header bar and tighter padding, for a small panel such as a code block.
  dense?: boolean;
  // Content that grows at its end (a log streaming in): each change of `pin` scrolls to the bottom, unless the
  // person scrolled up; back at the bottom, it follows again.
  pin?: string | number;
  children?: ReactNode;
};

// What each preset sets: its own face, the header's bar, whether a line closes it, the item size and the padded body.
// Every region pads its top and bottom alike (a header 20 and 20, a strip 12 and 12, a foot 14 and 14, rows 8 and 8), so
// no area can have room on one side and none on the other. Fixed areas are told apart by a line: under the header when a strip or a drawer's body follows, under each strip,
// over the footer. A plain dialog's header runs into its body with none; over strips (a search) it is tighter.
// A card is a quiet grey column whose edge is drawn over its body, so what scrolls past is cut by the line.
const presets = {
  dialog: { root: "overflow-hidden", bar: "items-start px-5 py-5", rule: false, size: "dialog", body: "px-5 pb-5" },
  drawer: { root: "overflow-hidden", bar: "h-16 items-center gap-2 px-5", rule: true, size: "small", body: "px-5 py-6" },
  card: { root: "relative rounded-panel bg-area", bar: "h-[42px] items-center gap-2 px-4", rule: true, size: "small", body: "gap-3 p-3" },
  page: { root: "", bar: "", rule: false, size: "medium", body: "" },
} as const;

export function Surface({
  preset, testid, className, style, title, line, lead, trailing, header, actions, close, onKeyDown, strips, inset: mode = "padded", column = measure.page + 80, scroll = true,
  scrollTop, dense, footer, dividers, pin, children, ref, role, titleId,
}: SurfaceProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [away, setAway] = useState(false);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (pin !== undefined && el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [pin]);
  // Whether the body scrolls: a surface whose body scrolls draws dividers under its header and over its footer; one
  // whose body fits draws none.
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return setOverflowing(false);
    const measure = () => setOverflowing(el.scrollHeight > el.clientHeight + 1);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    if (el.firstElementChild) watch.observe(el.firstElementChild);
    return () => watch.disconnect();
  }, [scroll, mode]);
  const toTop = () => {
    const el = scroller.current;
    if (!el) return;
    const from = el.scrollTop;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / scrollTopMilliseconds);
      el.scrollTop = from * (1 - (1 - (1 - t) ** 3));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const look = presets[preset];
  const item = title !== undefined && lead !== undefined;
  const page = preset === "page";
  const bar = !page && (item || !!header || !!actions || !!close);
  const has = children != null && children !== false;
  // A dialog's dividers come in pairs, one under the header and one over the footer, never one alone, by default while
  // the body scrolls. A drawer has them by default: its header's always, its footer's when it has one. A card's header
  // always has its rule; a search (strips) is framed by its own two.
  const wanted = dividers ?? (preset === "drawer" || overflowing);
  const divided = wanted && bar && (!!footer || preset === "drawer");
  const headRule = preset === "card" ? look.rule : divided || !!strips;
  return (
    <div
      ref={ref}
      role={role}
      aria-modal={role ? true : undefined}
      aria-labelledby={role && item ? titleId : undefined}
      tabIndex={role ? -1 : undefined}
      data-testid={testid}
      data-surface={preset}
      className={cn("flex min-h-0 flex-col bg-page", role && "outline-none", look.root, className)}
      style={style}
      onKeyDown={onKeyDown}
    >
      {preset === "card" && <span className="pointer-events-none absolute inset-0 z-10 rounded-panel" style={edge(palette.line)} />}
      {page && header && <div data-region="header">{header}</div>}
      {bar && (
        <div data-region="header" className={cn("relative flex shrink-0", dense && preset === "card" ? "h-8 items-center gap-2 px-3" : strips && preset === "dialog" ? "items-center px-5 py-3" : look.bar)}>
          <div className={cn("flex min-w-0 flex-1 gap-2", preset === "dialog" ? "items-start" : "items-center")}>
            {item ? <Item title={title} line={line} lead={lead} size={look.size} trailing={trailing} titleId={titleId} /> : header}
          </div>
          {(actions || close) && <span className={preset === "dialog" ? "min-w-3" : "w-1 shrink-0"} />}
          {actions}
          {close && <IconButton glyph="close" label="Close" fill={palette.area} onClick={close} />}
          {headRule && <EdgeRule />}
        </div>
      )}
      {strips && (
        <div data-region="strips" className="relative shrink-0 px-5 py-3">
          {strips}
          <EdgeRule />
        </div>
      )}
      {!has ? null : !scroll || mode === "gutter" ? (
        <div data-region="body" className={cn("flex min-h-0 flex-1 flex-col", mode === "gutter" && "p-5")}>{children}</div>
      ) : (
        <div data-region="body" className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={scroller}
            className="min-h-0 flex-1 overflow-y-auto"
            onScroll={(e) => {
              const el = e.currentTarget;
              pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
              if (scrollTop) setAway(el.scrollTop > scrollTopAfter);
            }}
          >
            {mode === "flush" || mode === "rows" ? (
              <div className={cn("flex min-h-full flex-col", mode === "rows" && "py-2")}>{children}</div>
            ) : mode === "centered" ? (
              // The page's column: its padding on all four sides, here and nowhere else; an empty state that fills it sits
              // in the middle of what is left.
              <div className="mx-auto flex min-h-full w-full flex-col items-stretch gap-5 px-10 pt-7 pb-16 [--state-offset:36px]" style={{ maxWidth: column }}>
                {children}
              </div>
            ) : (
              // A padded body starts on the header's left edge, under its icon.
              <div className={cn("flex flex-col items-stretch", look.body)}>
                {children}
              </div>
            )}
          </div>
          {scrollTop && (
            <div className={cn("absolute right-6 bottom-6 transition-opacity duration-[120ms]", away ? "opacity-100" : "pointer-events-none opacity-0")}>
              <IconButton glyph="arrowUp" label="Scroll to top" fill={palette.area} size={36} onClick={toTop} />
            </div>
          )}
        </div>
      )}
      {footer && (
        // The foot's buttons sit together at the right, the primary last, as a confirm's do: never one left, one right.
        <div data-region="footer" className="relative flex shrink-0 items-center justify-end gap-2 px-5 py-3.5">
          {footer}
          {divided && !!footer && <EdgeRule top />}
        </div>
      )}
    </div>
  );
}
