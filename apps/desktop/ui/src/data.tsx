import { Children, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "./cn";
import { Clickable } from "./clickable";
import { Glyph } from "./glyph";
import { Dropdown, type MenuEntry } from "./menu";
import {
  Dot, edge, GroupTitle, Item, itemSize, Pill, Rule, Skeleton, Tag, type ItemLine, type ItemSize, type Person,
  type TabStatus,
} from "./primitives";
import { AvatarStack } from "./avatars";
import { palette, tone as tones, type Tone } from "./tokens";

export function Stat({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: Tone }) {
  return (
    <div className="flex h-full w-full flex-col items-start gap-1.5 rounded-block bg-quiet px-[18px] py-4" style={edge(palette.line)}>
      <div className="flex items-center gap-2">
        {tone && <Dot tone={tone} />}
        <span className="text-[13px] text-secondary">{label}</span>
      </div>
      <span className="font-display text-[26px] tracking-[-0.5px] text-ink tabular-nums">{value}</span>
      <span className="text-[13px] text-tertiary">{detail}</span>
    </div>
  );
}

// Cards side by side (stats, choices) that end at one height, the tallest's, with the gap fields have between them: a
// row of cards and a row of fields never space differently.
export function CardRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full items-stretch gap-4">
      {Children.map(children, (child) => (
        <div className="flex min-w-0 flex-1 flex-col [&>*]:flex-1">{child}</div>
      ))}
    </div>
  );
}

// Cards in equal columns, wrapping, with the same gap in both directions as a row of fields has.
export function CardGrid({ columns = 3, children }: { columns?: 2 | 3 | 4; children: ReactNode }) {
  return (
    <div className={cn("grid w-full items-stretch gap-4", columns === 2 ? "grid-cols-2" : columns === 4 ? "grid-cols-4" : "grid-cols-3")}>
      {Children.map(children, (child) => (
        <div className="flex min-w-0 flex-col [&>*]:flex-1">{child}</div>
      ))}
    </div>
  );
}

// A section's head in a page: its title and what it is for, and one action on the right.
export function SectionHead({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex w-full items-start gap-4">
      <Item title={title} line={text ? { sub: text } : undefined} wrap />
      {action && <span className="ml-3 flex shrink-0">{action}</span>}
    </div>
  );
}

export type Series = { name: string; color: string };
export type Bar = { label: string; values: number[] };

// Stacked bars drawn to one scale, with gridlines at named values. `prefix` and `unit` frame the axis values ("$",
// "M"), or `label` writes a value whole; `every` labels one bar in so many, so 90 days stay readable. Gaps shrink with the number of bars.
export function StackedBars({
  series, bars, top, ticks, unit = "", prefix = "", label, height = 160, every,
}: { series: Series[]; bars: Bar[]; top: number; ticks: number[]; unit?: string; prefix?: string; label?: (tick: number) => string; height?: number; every?: number }) {
  const step = every ?? Math.max(1, Math.floor(bars.length / 14));
  const gap = bars.length > 60 ? 1 : bars.length > 30 ? 3 : 8;
  const corner = bars.length > 60 ? 1 : 3;
  return (
    <div className="flex w-full flex-col gap-2">
      <div className="relative w-full" style={{ height }}>
        {ticks.map((tick) => (
          <div key={tick} className="absolute inset-x-0 flex items-center gap-2" style={{ top: height - (tick / top) * height - 7, height: 14 }}>
            <span className="w-14 shrink-0 font-mono text-[11px] text-tertiary">{label ? label(tick) : `${prefix}${tick}${unit}`}</span>
            <span className="h-px flex-1 bg-line" />
          </div>
        ))}
        <div className="absolute inset-y-0 right-0 left-16 flex items-end" style={{ gap }}>
          {bars.map((bar, b) => (
            <div key={b} className="flex min-w-0 flex-1 justify-center">
              <div
                className="flex w-full max-w-7 flex-col overflow-hidden"
                style={{ gap: bars.length > 60 ? 0 : 1, borderTopLeftRadius: corner, borderTopRightRadius: corner }}
              >
                {bar.values.map((v, i) => (
                  <div key={i} className="shrink-0" style={{ height: (v / top) * height, background: series[i]?.color }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex pl-16" style={{ gap }}>
        {bars.map((bar, i) => (
          <span key={i} className="flex min-w-0 flex-1 justify-center font-mono text-[11px] whitespace-nowrap text-tertiary">
            {i % step === 0 ? bar.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Legend({ series }: { series: Series[] }) {
  return (
    <div className="flex items-center gap-4">
      {series.map((s) => (
        <span key={s.name} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px]" style={{ background: s.color }} />
          <span className="text-[13px] text-secondary">{s.name}</span>
        </span>
      ))}
    </div>
  );
}

// A day, or any group, heading a run of rows: its title and count where the rows' text starts, no line under it.
// `size` is the rows' item size: the title starts after their lead; null starts it at the edge.
export function GroupHead({ title, count, size = "medium" }: { title: string; count?: number; size?: ItemSize | null }) {
  const m = size ? itemSize[size] : undefined;
  return (
    <div className="flex h-9 w-full items-center" style={{ paddingLeft: m ? m.lead + m.gap : 0 }}>
      <GroupTitle title={title} count={count} />
    </div>
  );
}

export type TableRowProps = {
  index: number;
  selected?: boolean;
  raised?: boolean;
  action?: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
};

// What a table row adds to a medium item's height, shared above and below: white space around the hover fill, which
// keeps the item's height less 8pt (7pt clear of each line).
const tableRowRoom = 6;

// One row of a table: medium height, closed by its own bottom line. With an action, the row is clickable: the
// pointing hand, a hover fill past its sides, 7px clear of the lines above and below. `selected` keeps that fill on, in
// grey; `raised` lifts the row above its neighbours while its menu is open. The row's own controls take their
// clicks first.
export function TableRow({ index, selected = false, raised = false, action, disabled, className, children }: TableRowProps) {
  const height = itemSize.medium.row + tableRowRoom;
  const layers = cn(
    "relative flex w-full items-center",
    raised ? "z-10" : selected ? "z-[1]" : action && !disabled && "hover:z-[1] [.show-hover_&]:z-[1]",
    selected && "row-selected",
    className,
  );
  // Every row, the last included, closes with its own line; the fill stops 7px short of it and of the line above. The
  // line runs 8pt past the content, as the fill does, so the two share their edges.
  const line = <span className="pointer-events-none absolute -inset-x-2 bottom-0 z-[-2] h-px bg-line" />;
  if (!action) {
    return (
      <div className={cn(layers, "isolate")} style={{ height }}>
        {selected && <span className="pointer-events-none absolute -inset-x-2 top-[7px] bottom-[7px] z-[-1] rounded-block bg-area" />}
        {line}
        {children}
      </div>
    );
  }
  const fill = selected ? palette.area : palette.quiet;
  return (
    <Clickable
      onClick={action}
      disabled={disabled}
      handle={`row:${index}`}
      chosen={selected}
      fill={fill}
      radius={8}
      bleed={8}
      className={cn(layers, "before:top-[7px] before:bottom-[7px]", selected && "before:bg-(--fill)")}
      style={{ height, ...(selected ? ({ "--ring": palette.area } as CSSProperties) : {}) }}
    >
      {line}
      {children}
    </Clickable>
  );
}

export type Alignment = "leading" | "center" | "trailing";
const justify: Record<Alignment, string> = { leading: "justify-start", center: "justify-center", trailing: "justify-end" };

// A table cell of a fixed width. It keeps the width when its content is empty, so neighbours never shift.
export function Cell({ width, alignment = "leading", className, children }: { width: number; alignment?: Alignment; className?: string; children?: ReactNode }) {
  return (
    <div className={cn("flex min-h-px shrink-0 items-center", justify[alignment], className)} style={{ width }}>
      {children}
    </div>
  );
}

export type CellKind = "text" | "muted" | "number" | "time" | "code";

export const cellFace: Record<CellKind, string> = {
  text: "text-[13px] text-secondary",
  muted: "text-[13px] text-tertiary",
  number: "font-mono text-[13px] text-ink tabular-nums",
  time: "font-mono text-[12.5px] text-tertiary tabular-nums",
  code: "font-mono text-[12.5px] text-secondary",
};

// A value in a table column. Text in grey, muted for what is missing, numbers and times tabular in mono, code in
// mono. Without a width it takes the remaining space; a missing value shows the placeholder or keeps the width.
export function CellText({
  text, width, alignment = "leading", kind = "text", glyph, placeholder,
}: { text?: string | null; width?: number; alignment?: Alignment; kind?: CellKind; glyph?: string; placeholder?: string }) {
  return (
    <div
      className={cn("flex min-h-px items-center gap-1.5", justify[alignment], width === undefined ? "min-w-0 flex-1" : "shrink-0")}
      style={{ width }}
    >
      {text != null ? (
        <>
          {glyph && <Glyph name={glyph} size={12} color={palette.tertiary} />}
          <span className={cn("truncate", cellFace[kind])}>{text}</span>
        </>
      ) : placeholder ? (
        <>
          {/* A placeholder starts on the cell's edge, where its column head does. */}
          <span className="truncate text-[13px] text-tertiary">{placeholder}</span>
        </>
      ) : null}
    </div>
  );
}

// A detail of a settings drawer or page: the label on the left, the value on the right.
export function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex h-8 w-full items-center gap-2">
      <span className="flex-1 text-[13px] text-tertiary">{label}</span>
      <span className={cn("truncate text-ink", mono ? "font-mono text-[12.5px]" : "text-[13px]")}>{value}</span>
    </div>
  );
}

// The ⋯ of a row: our menu, opening from the right edge.
export function RowMenu({
  entries, open, onOpenChange, label = "Actions",
}: { entries: MenuEntry[]; open?: boolean; onOpenChange?: (open: boolean) => void; label?: string }) {
  return (
    <span aria-label={label} data-testid={`button:${label}`} className="inline-flex shrink-0">
      <Dropdown entries={entries} edge="trailing" width={220} fill={palette.area} open={open} onOpenChange={onOpenChange} label={(on) => <MoreFace on={on} />} />
    </span>
  );
}

// The ⋯ glyph: ink when its row or itself is hovered, or its menu open.
export function MoreFace({ on }: { on: boolean }) {
  return (
    <span className={cn("flex size-7 items-center justify-center", on ? "text-ink" : "text-tertiary hovering:text-ink")}>
      <Glyph name="more" size={14} color="currentColor" width={1.6} />
    </span>
  );
}

// The face of a column title, shared by `ColumnHeads` and the conversation's table.
export const columnHeadFace = "font-mono text-[11px] font-medium tracking-[0.6px] text-tertiary uppercase";

export type Column = [title: string, width: number | null, alignment?: Alignment];

// Column titles over a list.
export function ColumnHeads({ columns }: { columns: Column[] }) {
  return (
    <div className="relative flex h-9 w-full items-center gap-4">
      {columns.map(([title, width, align = "leading"], i) => {
        // The last column ends on the table's right edge, as the rows' last element does.
        const a = i === columns.length - 1 && columns.length > 1 ? "trailing" : align;
        return (
          <span
            key={i}
            className={cn("flex truncate", columnHeadFace, justify[a], width === null ? "min-w-0 flex-1" : "shrink-0")}
            style={width === null ? undefined : { width }}
          >
            {title}
          </span>
        );
      })}
      {/* The line runs 8pt past the columns, as the rows' lines and their hover fill do. */}
      <Rule className="absolute -inset-x-2 bottom-0 w-auto" />
    </div>
  );
}

// One row of a `DayList`: a lead tile, a title with its line, a pill, the repository, the environment and the age.
// A tab session's row names its tab in the repository's place and has no environment.
export type DayRow = {
  id: string;
  glyph: string;
  tone?: Tone;
  title: string;
  line?: ItemLine;
  // Tints a subtitle with the row's state.
  lineTone?: Tone;
  // Done with: the title greys.
  off?: boolean;
  pill?: { text: string; tone: Tone };
  owner?: string;
  repo?: string;
  environment?: string | null;
  age: string;
  people?: Person[];
  tab?: TabStatus;
};

// A day of a `DayList` and its rows.
export type DayGroup = { title: string; rows: DayRow[] };

// Rows by day, as Sessions and the Inbox list them: a section per day with its count where the rows' text
// starts, medium rows split by lines. Columns are the same for every row of the list: the pill and people columns
// show when any row has one, the menu column when `menu` is given, and each keeps its width when a cell is empty.
// A row opens with `open`; its menu lifts it above its neighbours while open.
export function DayList({
  groups, selected, open, menu: rowMenu, pageSize, aside,
}: {
  groups: DayGroup[];
  selected?: string;
  open?: (row: DayRow) => void;
  menu?: (row: DayRow) => MenuEntry[];
  // Shows whole days up to about this many rows, then a Load more that adds as many again. A day is never cut.
  pageSize?: number;
  // On the full right of the row under the list.
  aside?: FootAction;
}) {
  const [raised, setRaised] = useState<string | null>(null);
  const [limit, setLimit] = useState(pageSize ?? Infinity);
  const shown: DayGroup[] = [];
  let rows = 0;
  for (const day of groups) {
    if (shown.length > 0 && rows >= limit) break;
    shown.push(day);
    rows += day.rows.length;
  }
  const more = shown.length < groups.length;
  const pills = groups.some((g) => g.rows.some((r) => r.pill));
  const people = groups.some((g) => g.rows.some((r) => r.people?.length));
  return (
    <div className="flex w-full flex-col items-stretch gap-7">
      {shown.map((day, d) => (
        <div key={day.title} className="flex flex-col">
          <GroupHead title={day.title} count={day.rows.length} size="medium" />
          {day.rows.map((r, i) => {
            const entries = rowMenu?.(r) ?? [];
            const lineDot = r.lineTone ? tones[r.lineTone].dot : undefined;
            return (
              <TableRow key={r.id} index={i} selected={selected === r.id} raised={raised === r.id} action={() => open?.(r)} className={cn("gap-4", r.off && "opacity-55")}>
                <Item
                  title={r.title}
                  line={r.line}
                  lead={{ tile: r.glyph, tone: r.tone ?? "grey" }}
                  size="medium"
                 
                  color={r.off ? palette.secondary : palette.ink}
                  lineDot={lineDot}
                />
                <div className="flex w-[140px] shrink-0">
                  {r.tab ? (
                    <Item title={r.tab.owner || "Tab"} line={r.tab.owner ? { over: "Tab" } : undefined} lead={{ visual: "globe" }} size="small" color={palette.secondary} />
                  ) : (
                    <Item title={r.repo ?? ""} line={{ over: r.owner ?? "" }} lead={{ visual: "repo" }} size="small" color={palette.secondary} />
                  )}
                </div>
                {people && <Cell width={64}>{r.people?.length ? <AvatarStack people={r.people} size={22} /> : null}</Cell>}
                <CellText text={r.age} width={36} alignment="trailing" kind="time" />
                {/* Badges and pills sit last, before the menu. */}
                <Cell width={96}>{r.environment && <Tag text={r.environment} size="small" shrink />}</Cell>
                {pills && <Cell width={100} alignment="trailing">{r.pill && <Pill text={r.pill.text} tone={r.pill.tone} />}</Cell>}
                {rowMenu && (
                  <Cell width={28}>
                    {entries.length > 0 && (
                      <RowMenu
                        entries={entries}
                        open={raised === r.id}
                        onOpenChange={(on) => setRaised(on ? r.id : null)}
                        label={`Actions for ${r.title}`}
                      />
                    )}
                  </Cell>
                )}
              </TableRow>
            );
          })}
          {/* The links under the list live in its last day. */}
          {d === shown.length - 1 && (more || aside) && (
            <ListLink text={more ? "Load more" : undefined} glyph="arrowDown" onClick={() => setLimit(limit + (pageSize ?? 0))} aside={aside} />
          )}
        </div>
      ))}
    </div>
  );
}

// The row under a list: a link on the left, its glyph on the rows' text edge and its words after it ("See all sessions",
// "Load more"), and something on the full right (a "Show archived" button). Either side may be left out.
export type FootAction = { text: string; glyph: string; onClick?: () => void };

// The foot of a list: an action under the text edge on the left, another at the far right.
export function ListLink({ text, glyph, onClick, aside }: { text?: string; glyph?: string; onClick?: () => void; aside?: FootAction }) {
  return (
    <div className="flex items-center justify-between pt-4">
      <div className="flex" style={{ paddingLeft: itemSize.medium.lead + itemSize.medium.gap }}>
        {text && <LinkButton text={text} glyph={glyph} onClick={onClick} />}
      </div>
      {aside && (
        <div className="pr-2">
          <LinkButton {...aside} />
        </div>
      )}
    </div>
  );
}

// A quiet text button, with a glyph before it when given: the foot of a list.
function LinkButton({ text, glyph, onClick }: { text: string; glyph?: string; onClick?: () => void }) {
  return (
    // The button's fill reaches 8 past its content, so its glyph keeps the text edge.
    <Clickable bleed={8} onClick={onClick} label={text} handle={`button:${text}`} className="inline-flex h-8 items-center gap-2">
      {glyph && <Glyph name={glyph} size={13} color={palette.secondary} width={1.6} />}
      <span className="text-[13px] text-secondary">{text}</span>
    </Clickable>
  );
}

// A session in a list: its state, title, the reason it needs attention, where it runs and how old it is. A tab
// session runs in a member's tab: a globe on its tile, the tab in the repository's place, no environment.
export type SessionSummary = {
  title: string;
  reason?: string | null;
  tone: Tone;
  owner?: string;
  repo?: string;
  environment?: string;
  age: string;
  people?: Person[];
  tab?: TabStatus;
};

// Rows not loaded yet: grey bars where the lead and the two lines will be, and short bars at the right where a
// table's `columns` will be. A page's list loads with these; details inside a page load with the spinner.
export function SkeletonRows({ count = 3, columns = 2 }: { count?: number; columns?: number }) {
  const m = itemSize.medium;
  return (
    <div aria-label="Loading" className="flex w-full flex-col">
      {Array.from({ length: count }, (_, i) => (
        <TableRow key={i} index={i} className="items-center">
          <div className="flex items-center" style={{ gap: m.gap }}>
            <Skeleton className="rounded-button" style={{ width: m.lead, height: m.lead }} />
            <div className="flex flex-col items-start gap-1.5">
              <Skeleton className="h-2.5" style={{ width: [180, 140, 210][i % 3] }} />
              <Skeleton className="h-2 opacity-60" style={{ width: [120, 160, 90][i % 3] }} />
            </div>
          </div>
          {columns > 0 && (
            <div className="ml-auto flex items-center gap-10">
              {Array.from({ length: columns }, (_, c) => (
                <Skeleton key={c} className="h-2.5" style={{ width: [56, 72, 44][(i + c) % 3] }} />
              ))}
            </div>
          )}
        </TableRow>
      ))}
    </div>
  );
}
