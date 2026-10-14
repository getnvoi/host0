import { useContext, type ReactNode } from "react";
import { Clickable } from "./clickable";
import { cn } from "./cn";
import { Glyph, Turn } from "./glyph";
import { Dropdown, menu } from "./menu";
import { alpha, Avatar, edge, GroupTitle, WorkspaceTile } from "./primitives";
import { palette } from "./tokens";
import { HiddenPages, NavRow, settingsGroups } from "./heads";

// The places a sidebar row opens, before the settings groups.
const places: [string, string][] = [
  ["Inbox", "inbox"],
  ["Sessions", "session"],
  ["Library", "file"],
  ["Artifacts", "artifact"],
];

export const sidebarWidth = 240;

export type SidebarProps = {
  // The title of the page the active tab shows ("Sessions", "Members").
  active?: string;
  // Counts beside places ("Inbox": 2).
  counts?: Record<string, number>;
  // The workspace, at the top: its name, the other workspaces and its member count.
  workspace?: { name: string; others?: string[]; members?: number };
  // Who is signed in, at the foot.
  account?: { name: string; email: string; initials: string };
  // A row's title, a menu entry's title, or another workspace's name.
  choose?: (title: string) => void;
};

// Pages reached from the account's menu, not from the rows.
const inMenus = new Set(["Profile", "Security"]);

// The window's sidebar, under the body when it slides right: the workspace's menu at the top, the places and the
// settings groups scrolling under fades, the account's menu at the foot. A row opens its page as the commander does.
export function Sidebar({ active, counts, workspace, account, choose = () => {} }: SidebarProps) {
  const hidden = useContext(HiddenPages);
  const all: [string, [string, string][]][] = [["Places", places], ...settingsGroups];
  const groups = all
    .map(([group, rows]): [string, [string, string][]] => [group, rows.filter(([title]) => !inMenus.has(title) && !hidden.includes(title))])
    .filter(([, rows]) => rows.length > 0);
  return (
    <div data-testid="nav:Sidebar" className="flex h-full flex-col bg-frame [--click-fill:var(--color-frame-pressed)]" style={{ width: sidebarWidth }}>
      {workspace && (
        <div className="shrink-0 px-3 pt-3">
          <Dropdown
            className="w-full"
            width={sidebarWidth - 24}
            fill="clear"
            handle="button:Workspace"
            entries={[
              menu.title("Workspaces"),
              menu.item(workspace.name, { workspace: workspace.name, checked: true }),
              ...(workspace.others ?? []).map((other) => menu.item(other, { workspace: other, action: () => choose(other) })),
              menu.divider,
              menu.item("New workspace", { glyph: "plus", action: () => choose("New workspace") }),
            ]}
            label={(open) => (
              // A white select card on the frame; the field's hover fill under the pointer or while open.
              <span
                className={cn("flex h-9 w-full items-center gap-2.5 rounded-button px-2", open ? "bg-quiet" : "bg-page hovering:bg-quiet")}
                style={edge(alpha(palette.ink, 0.05))}
              >
                <WorkspaceTile name={workspace.name} size={22} />
                <span className="min-w-0 flex-1 truncate text-left text-[14px] font-medium text-ink">{workspace.name}</span>
                <Turn menu>
                  <Glyph name="chevronDown" size={12} color={palette.secondary} width={1.6} />
                </Turn>
              </span>
            )}
          />
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <nav className="flex h-full flex-col gap-4 overflow-y-auto px-3 pt-5 pb-4">
          {groups.map(([group, rows]) => (
            <section key={group} className="flex flex-col">
              {/* The title starts on the rows' text, past their glyph. */}
              <GroupTitle title={group} className="pb-1.5 pl-[34px]" />
              {rows.map(([title, glyph]) => (
                <NavRow key={title} title={title} glyph={glyph} count={title === "Members" ? workspace?.members : counts?.[title]} selected={title === active} onClick={() => choose(title)} />
              ))}
            </section>
          ))}
        </nav>
        {/* The rows scroll under the frame: solid at both ends, clear toward the middle. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-4 bg-linear-to-b from-frame to-frame/0" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-linear-to-t from-frame to-frame/0" />
      </div>
      {account && (
        <div className="shrink-0 px-3 pb-3">
          <Dropdown
            className="w-full"
            above
            handle="button:Account"
            width={sidebarWidth - 24}
            entries={[
              menu.item("Profile", { glyph: "at", action: () => choose("Profile") }),
              menu.item("Security", { glyph: "lock", action: () => choose("Security") }),
              menu.item("Theme", { glyph: "theme", action: () => choose("Theme") }),
              menu.divider,
              menu.item("Sign out", { glyph: "signOut", action: () => choose("Sign out") }),
            ]}
            label={() => (
              <span className="flex h-12 w-full items-center gap-2.5 rounded-control px-2">
                <Avatar initials={account.initials} size={28} />
                <span className="flex min-w-0 flex-1 flex-col text-left">
                  <span className="truncate text-[14px] leading-5 font-medium text-ink">{account.name}</span>
                  <span className="truncate text-[12.5px] leading-4 text-tertiary">{account.email}</span>
                </span>
                <Turn menu>
                  <Glyph name="chevronDown" size={12} color={palette.secondary} width={1.6} />
                </Turn>
              </span>
            )}
          />
        </div>
      )}
    </div>
  );
}

// The sidebar's toggle, right after the traffic lights: a quiet glyph, the strip's hover fill.
export function SidebarToggle({ open, toggle }: { open: boolean; toggle: () => void }) {
  return (
    <Clickable onClick={toggle} label="Sidebar" handle="button:Sidebar" chosen={open} className="flex size-7 items-center justify-center [--click-fill:var(--color-frame-pressed)]">
      <Glyph name="sidebar" size={15} color={palette.secondary} width={1.6} />
    </Clickable>
  );
}

export type WindowProps = {
  // The tab strip, drawn across the top.
  strip: (flush: boolean) => ReactNode;
  // The sidebar's content, shown under the body when it slides right.
  sidebar: ReactNode;
  open: boolean;
  toggle: () => void;
  // The first tab is the active one: it stands on the body's edge, so the corner under it stays square.
  first?: boolean;
  // The active tab's page, inside the white card.
  children: ReactNode;
  // Overlays over the whole window (commander, dialogs).
  over?: ReactNode;
  // Where the slide stands, 0 closed to 1 open, when the app drives it frame by frame (a native view over the body
  // moves with it); the CSS transition is off while it is given.
  progress?: number;
};

// The window: the strip with the sidebar toggle after the traffic lights, and the body under it, edge to edge. Opening
// the sidebar slides the body's left edge and the tabs right, a hairline on that edge; the sidebar shows underneath.
// `strip` takes `flush` so its first tab stands on that edge.
export function Window({ strip, sidebar, open, toggle, first = false, children, over, progress }: WindowProps) {
  // Open with another tab active, the body's top-left corner rounds under the grey strip.
  const round = open && !first ? 10 : 0;
  const driven = progress !== undefined;
  const at = progress ?? (open ? 1 : 0);
  return (
    <div className="relative flex h-full flex-col bg-frame contain-layout">
      <div data-drag className="relative z-30 shrink-0">
        <div className="absolute top-[8.5px] left-[84px] z-10">
          <SidebarToggle open={open} toggle={toggle} />
        </div>
        <div className={driven ? "" : "transition-[padding] duration-(--duration-drawer) ease-(--ease-panel)"} style={{ paddingLeft: 128 + (sidebarWidth - 128) * at }}>
          {strip(open)}
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1">
        <div className="absolute inset-y-0 left-0">{sidebar}</div>
        {/* data-window-body: native views placed over the body read its final margin while it slides. */}
        <div
          data-window-body
          className={cn(
            "relative flex min-w-0 flex-1 flex-col overflow-hidden bg-page duration-(--duration-drawer) ease-(--ease-panel)",
            driven ? "transition-[border-radius]" : "transition-[margin,border-radius]",
          )}
          style={{ marginLeft: sidebarWidth * at, borderTopLeftRadius: round }}
        >
          {children}
          <div
            className="pointer-events-none absolute inset-0 z-10 border-l border-line transition-[opacity,border-radius] duration-(--duration-drawer)"
            style={{ opacity: open ? 1 : 0, borderTopLeftRadius: round }}
          />
        </div>
      </div>
      {over}
    </div>
  );
}
