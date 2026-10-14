import { useState, type CSSProperties, type ReactNode } from "react";
import type { Components, ExtraProps } from "react-markdown";
import { cn } from "./cn";
import { cellFace, columnHeadFace } from "./data";
import { edge, Tag } from "./primitives";
import { palette } from "./tokens";

// The widest a cell grows before its text is clipped with an ellipsis: the first column, then the others.
const FIRST_CELL_MAX = 260;
const CELL_MAX = 360;

// Tables with fewer body rows than this show no footer.
const FOOTER_MIN_ROWS = 2;

type Node = ExtraProps["node"];

// The text of a cell, for its title when the cell clips.
function textOf(children: ReactNode): string {
  if (children == null || typeof children === "boolean") return "";
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(textOf).join("");
  if (typeof children === "object" && "props" in children) return textOf((children.props as { children?: ReactNode }).children);
  return "";
}

// The body rows of a markdown table's syntax node.
function rowCount(node: Node): number {
  const body = node?.children.find((c) => c.type === "element" && c.tagName === "tbody");
  return body && "children" in body ? body.children.filter((c) => c.type === "element").length : 0;
}

type Align = "left" | "center" | "right" | undefined;

const alignClass = { left: "text-left", center: "text-center", right: "text-right" } as const;

// A markdown table as a card: header band, 36px rows, the first column pinned while it scrolls sideways, a footer with
// the row count. One line colour draws every line; the edge is an overlay, so it stays fixed under the scrolling cells.
export function ConversationTable({ children, node }: { children?: ReactNode; node?: Node }) {
  const [scrolled, setScrolled] = useState(false);
  const rows = rowCount(node);
  return (
    <div className="relative mb-3 overflow-hidden rounded-block bg-page" data-testid="table:conversation">
      <div
        className="group/scroll overflow-x-auto"
        data-scrolled={scrolled ? "" : undefined}
        onScroll={(e) => setScrolled(e.currentTarget.scrollLeft > 0)}
      >
        {/* The last row has no line: the footer's top line, or the card's edge, closes the table. */}
        <table className="w-full border-separate border-spacing-0 [&_tbody_tr:last-child_td]:border-b-0">{children}</table>
      </div>
      {rows >= FOOTER_MIN_ROWS && (
        <div className="flex h-9 items-center gap-1.5 border-t border-line bg-quiet px-3 tabular-nums" data-testid="table:footer">
          <Tag text={`${rows} rows`} size="small" />
        </div>
      )}
      <span aria-hidden className="pointer-events-none absolute inset-0 z-10 rounded-block" style={edge(palette.line)} />
    </div>
  );
}

function alignOf(style: CSSProperties | undefined): Align {
  const a = style?.textAlign;
  return a === "left" || a === "center" || a === "right" ? a : undefined;
}

// The pinned first column's right line shows only once the table has scrolled.
const pinned = "first:sticky first:left-0 first:border-r first:border-r-transparent group-data-[scrolled]/scroll:first:border-r-line";

function Head({ children, style }: { children?: ReactNode; style?: CSSProperties }) {
  const align = alignOf(style);
  return (
    <th
      className={cn("h-9 border-b border-line bg-quiet px-3 whitespace-nowrap first:z-[2]", pinned, columnHeadFace, align ? alignClass[align] : "text-left")}
    >
      {children}
    </th>
  );
}

// The first cell of a row is medium ink; a column aligned right holds numbers, in mono with tabular figures.
function Body({ children, style }: { children?: ReactNode; style?: CSSProperties }) {
  const align = alignOf(style);
  const title = textOf(children);
  return (
    <td
      style={{ "--cell-max": `${CELL_MAX}px`, "--first-max": `${FIRST_CELL_MAX}px` } as CSSProperties}
      className={cn(
        "h-9 border-b border-line px-3 align-middle whitespace-nowrap first:z-[1] first:bg-page first:font-medium first:text-ink",
        "[&_code]:rounded-chip [&_code]:px-1 [&_code]:text-[13px]",
        pinned,
        align === "right" ? cellFace.number : cellFace.text,
        align ? alignClass[align] : "text-left",
      )}
    >
      <span className="block max-w-(--cell-max) truncate [td:first-child_&]:max-w-(--first-max)" title={title || undefined}>
        {children}
      </span>
    </td>
  );
}

export const conversationTable: Components = {
  table: ({ children, node }) => <ConversationTable node={node}>{children}</ConversationTable>,
  th: ({ children, style }) => <Head style={style}>{children}</Head>,
  td: ({ children, style }) => <Body style={style}>{children}</Body>,
};
