import { useEffect, useMemo, useRef, useState } from "react";
import Fuse from "fuse.js";
import { Busy, useDelayedBusy } from "./busy";
import { cn } from "./cn";
import { Backdrop, Clickable } from "./clickable";
import { Glyph } from "./glyph";
import { menu, MenuPanel, useEscape } from "./menu";
import { usePresence } from "./presence";
import { useScrollLock } from "./scrolllock";
import { searchableWindow, Surface } from "./surface";
import { alpha, edge, GroupTitle, Item, Kbd, KeyHint, Pill, Tag } from "./primitives";
import { palette, type Tone } from "./tokens";

export type CommanderRight = { pill: [string, Tone] } | { keys: string[] } | { tag: string } | { check: true } | undefined;

export type CommanderRow = {
  // Tells apart rows that read the same, such as two sessions with one title.
  key?: string;
  title: string;
  subtitle?: string;
  lead: string;
  workspace?: boolean;
  right?: CommanderRight;
};

// `matched`: rows the API found for the query (a session by its transcript), kept whatever their words. `list`: a
// kind of thing (sessions, environments): its first rows show, then "See all", which shows the group whole.
// `loading`: its rows are on their way; skeleton rows hold their place.
export type CommanderGroup = { title: string; rows: CommanderRow[]; matched?: boolean; list?: boolean; loading?: boolean };

// Rows a list shows before its "See all".
const shown = 4;
const more = "more ";

// How loosely a typed word may differ from a row's words: 0 is exact, 1 matches anything. A transposed pair in a
// six letter word still matches.
const fuzziness = 0.4;

// The first letter of each word, so "he" finds "Health endpoint".
const initialsOf = (text: string) => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((w) => w[0]).join("");

// Whether a row holds every typed word, or its initials start with it.
function holds(row: CommanderRow, words: string[]) {
  const text = `${row.title} ${row.subtitle ?? ""}`.toLowerCase();
  const initials = initialsOf(row.title).toLowerCase();
  return words.every((w) => text.includes(w) || initials.startsWith(w));
}

// Rows that match every typed word, best first. `near`: no row of any group holds the words, so near spellings match;
// otherwise only the rows holding them do.
function ranked(rows: CommanderRow[], query: string, near: boolean): CommanderRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!near) return rows.filter((row) => holds(row, words));
  const docs = rows.map((row) => ({ row, title: row.title, subtitle: row.subtitle ?? "", initials: initialsOf(row.title) }));
  const fuse = new Fuse(docs, { keys: [{ name: "title", weight: 3 }, { name: "initials", weight: 2 }, { name: "subtitle", weight: 1 }], threshold: fuzziness, ignoreLocation: true });
  return fuse.search({ $and: words.map((w) => ({ $or: [{ title: w }, { subtitle: w }, { initials: w }] as Record<string, string>[] })) }).map((hit) => hit.item.row);
}

export const rowId = (row: CommanderRow) => row.key ?? row.title + (row.subtitle ?? "");

export type CommanderProps = {
  groups: CommanderGroup[];
  // Without `query`, the commander keeps its own.
  query?: string;
  onQuery?: (q: string) => void;
  choose?: (row: CommanderRow) => void;
  close?: () => void;
  // Opens on one group shown whole, for the gallery.
  scope?: string;
};

// The main navigation: a query that filters grouped rows; ↑↓ move, ↵ chooses, esc closes.
export function Commander({ groups, query: external, onQuery, choose = () => {}, close = () => {}, scope: initial }: CommanderProps) {
  const [typed, setTyped] = useState("");
  const query = external ?? typed;
  const setQuery = onQuery ?? setTyped;
  const [selected, setSelected] = useState(0);
  // One group shown whole, from its "See all" row; the chip beside the search names it.
  const [scope, setScope] = useState(initial);
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const near = !groups.some((g) => !g.matched && g.rows.some((row) => holds(row, words)));
    const found = (g: CommanderGroup) => (g.matched || !q ? g : { ...g, rows: ranked(g.rows, q, near) });
    if (scope) return groups.filter((g) => g.title === scope).map(found);
    // A list shows its first rows, then always "See all".
    return groups
      .map(found)
      .filter((g) => g.rows.length || g.loading)
      .map((g) => (g.list && !g.loading ? { ...g, rows: [...g.rows.slice(0, shown), { key: more + g.title, title: `See all ${g.title.toLowerCase()}`, subtitle: String(g.rows.length), lead: "seeAll" }] } : g));
  }, [groups, q, scope]);
  const field = useRef<HTMLInputElement>(null);
  // Picking a group or leaving it hands the keys back to the search.
  const leave = () => {
    setScope(undefined);
    setSelected(0);
    field.current?.focus();
  };
  const pick = (row: CommanderRow) => {
    if (!row.key?.startsWith(more)) return choose(row);
    setScope(row.key.slice(more.length));
    setSelected(0);
    field.current?.focus();
  };
  const flat = visible.flatMap((g) => g.rows);
  const list = useRef<HTMLDivElement>(null);
  // Arrow keys bring the selection into view; hover only moves it.
  const keyed = useRef(false);
  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    if (!keyed.current) return;
    keyed.current = false;
    list.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  useEscape(() => (scope ? leave() : close()));
  let index = 0;
  return (
    <Surface
      preset="dialog"
      testid="dialog:Commander"
      className="w-[680px] overflow-hidden rounded-[12px] shadow-commander [--click-fill:var(--color-area)]"
      style={{ height: searchableWindow }}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") keyed.current = true;
        if (e.key === "ArrowDown") {
          setSelected(Math.min(selected + 1, Math.max(flat.length - 1, 0)));
          e.preventDefault();
        } else if (e.key === "ArrowUp") {
          setSelected(Math.max(selected - 1, 0));
          e.preventDefault();
        } else if (e.key === "Enter" && flat[selected]) {
          pick(flat[selected]);
        } else if (e.key === "Backspace" && scope && !query) {
          leave();
        }
      }}
      inset="flush"
      strips={
        <div className="flex h-10 items-center gap-3">
          <span className="flex w-6 justify-center">
            <Glyph name="search" size={16} />
          </span>
          {/* The group shown whole, as a token before the words: Backspace on an empty field takes it away. */}
          {scope && (
            <Clickable fill="clear" onClick={leave} label={`All, not only ${scope.toLowerCase()}`} handle="button:Scope" className="inline-flex shrink-0">
              <span className="flex h-7 items-center gap-1.5 rounded-control bg-area pr-1.5 pl-2.5 text-[14px] font-medium text-ink hovering:bg-pressed" style={edge(alpha(palette.ink, 0.05))}>
                {scope}
                <Glyph name="close" size={12} color={palette.secondary} width={1.6} />
              </span>
            </Clickable>
          )}
          <input
            ref={field}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={scope ? `Search ${scope.toLowerCase()}` : "Search sessions, repositories, settings"}
            data-testid="input:Commander"
            className="min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-tertiary"
          />
          {!scope && <Tag text="All" size="small" />}
        </div>
      }
      footer={
        <div className="flex w-full items-center gap-5">
          <KeyHint keys={["↑", "↓"]} text="Move" />
          <KeyHint keys={["↵"]} text="Open" />
          <span className="flex-1" />
          <KeyHint keys={["esc"]} text="Close" />
        </div>
      }
    >
      <div ref={list} className="pb-3">
        {flat.length === 0 && <div className="p-5 text-[14px] text-tertiary">Nothing matches “{query}”</div>}
        {visible.map((group, g) => (
          <div key={g} className="flex flex-col gap-0.5 px-3 pt-4">
            <GroupTitle title={group.title} className="pb-2 pl-[46px]" />
            <Busy busy={!!group.loading} fallback={<CommanderSkeleton />}>{null}</Busy>
            {group.rows.map((row) => {
              const i = index++;
              const on = i === selected;
              return (
                <Clickable key={rowId(row)} fill="clear" onClick={() => pick(row)} handle={`command:${row.title}`} data-index={i} onMouseEnter={() => setSelected(i)}>
                  {row.key?.startsWith(more) ? (
                    // Smaller than the rows above and set in from them: the arrow starts on their text edge.
                    <div className={cn("flex h-9 items-center gap-2 rounded-block pr-3 pl-[46px]", on && "bg-area")}>
                      <Glyph name="seeAll" size={13} color={palette.tertiary} width={1.6} />
                      <span className="text-[13px] text-secondary">{row.title}</span>
                      <span className="text-[13px] text-tertiary">{row.subtitle}</span>
                    </div>
                  ) : (
                    <div className={cn("flex min-h-12 items-center gap-3 rounded-block px-3 py-1.5", on && "bg-area")}>
                      <Item
                        title={row.title}
                        line={row.subtitle ? { sub: row.subtitle } : undefined}
                        lead={row.workspace ? { workspace: row.title } : { visual: row.lead }}
                        size="small"
                       
                      />
                      <Right right={row.right} />
                    </div>
                  )}
                </Clickable>
              );
            })}
          </div>
        ))}
      </div>
    </Surface>
  );
}

// Rows on their way, drawn as the rows will be: the lead tile, a title and a line.
function CommanderSkeleton() {
  const shown = useDelayedBusy(true);
  return (
    <div aria-label="Loading" className={cn("flex flex-col gap-0.5", !shown && "invisible")}>
      {[180, 140, 210, 160].map((width, i) => (
        <div key={i} className="flex min-h-12 items-center gap-2.5 px-3 py-1.5">
          <span className="size-6 shrink-0 rounded-control bg-area" />
          <span className="flex flex-col gap-1.5">
            <span className="h-2.5 rounded-full bg-area" style={{ width }} />
            <span className="h-2 rounded-full bg-quiet" style={{ width: width - 50 }} />
          </span>
        </div>
      ))}
    </div>
  );
}

function Right({ right }: { right: CommanderRight }) {
  if (!right) return null;
  if ("pill" in right) return <Pill text={right.pill[0]} tone={right.pill[1]} />;
  if ("keys" in right) {
    return (
      <span className="flex gap-1">
        {right.keys.map((k) => (
          <Kbd key={k} k={k} />
        ))}
      </span>
    );
  }
  if ("tag" in right) return <Tag text={right.tag} size="small" />;
  return <Glyph name="check" size={12} color={palette.ink} width={2} />;
}

// The commander over the window: the scrim, the panel 96 points from the top and never closer to the bottom; its
// list scrolls when the window is short.
// It opens constantly, so it appears at once; it leaves with a short fade.
export function CommanderOverlay(props: CommanderProps) {
  const root = useRef<HTMLDivElement>(null);
  useScrollLock(root);
  usePresence(root);
  return (
    <div ref={root} className="fixed inset-0 z-40 flex items-start justify-center py-24">
      <Backdrop close={() => props.close?.()} />
      <div className="presence-panel presence-exit relative flex">
        <Commander {...props} />
      </div>
    </div>
  );
}

export type AccountMenuProps = {
  workspace: string;
  detail: string;
  others: string[];
  name: string;
  email: string;
  initials: string;
  // The workspace's member count beside Members.
  members?: number;
  choose?: (choice: string) => void;
};

// Opened from the workspace item: the workspace's pages, the other workspaces, the account.
export function AccountMenu({ workspace, detail, others, name, email, initials, members, choose = () => {} }: AccountMenuProps) {
  return (
    <MenuPanel
      width={300}
      entries={[
        menu.header(workspace, detail, { workspace }),
        menu.item("Settings", {
          glyph: "gear",
          keys: ["⌘", ","],
          action: () => choose("Settings"),
        }),
        menu.item("Members", {
          glyph: "people",
          count: members,
          action: () => choose("Members"),
        }),
        menu.item("Usage", { glyph: "chart", action: () => choose("Usage") }),
        menu.item("Billing", {
          glyph: "card",
          action: () => choose("Billing"),
        }),
        menu.divider,
        menu.title("Workspaces"),
        menu.item(workspace, { workspace, checked: true }),
        ...others.map((other) => menu.item(other, { workspace: other, action: () => choose(other) })),
        menu.item("New workspace", {
          glyph: "plus",
          action: () => choose("New workspace"),
        }),
        menu.divider,
        menu.header(name, email, { avatar: initials }),
        menu.item("Sign out", {
          glyph: "signOut",
          action: () => choose("Sign out"),
        }),
      ]}
    />
  );
}

