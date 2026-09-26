import { useEffect, useId, useState, type HTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router";
import { Button, type ButtonProps } from "./button";
import { Count } from "./count";
import { cx } from "./cx";
import { Glyph } from "./glyph";
import { Menu, type MenuItem } from "./menu";
import { Tile } from "./tile";
import { Tooltip } from "./tooltip";

// Ds::Sidebar: the sidebar down the left of every app page: the workspace menu at the top, the main places, the
// recent sessions, the account at the foot. 256px, or a 64px rail of faces and dots whose names show as tooltips.
// Only the width changes; the names stay readable to screen readers in the rail.
export type SidebarPlace = {
  label: string;
  icon: string;
  href?: string;
  count?: number;
  active?: boolean;
  // True or the reason, "Soon" by default.
  disabled?: boolean | string;
};

export type SidebarProps = {
  collapsed?: boolean;
  // localStorage key under which the toggle remembers the width; none keeps it for the page only.
  storageKey?: string;
  // Where the + in the Recent bar goes; none hides it.
  newSession?: string;
  // More props for the +.
  newSessionProps?: Partial<ButtonProps>;
  recent?: string;
  empty?: string;
  id?: string;
  // The workspace in use, its tile and name opening the workspace menu.
  workspace?: { name: string; items: MenuItem[]; src?: string };
  places?: SidebarPlace[];
  sessions?: SidebarRowProps[];
  // Who is signed in, opening the account menu upwards.
  account?: { name: string; email?: string; items?: MenuItem[]; src?: string };
  onToggle?: (collapsed: boolean) => void;
} & Omit<HTMLAttributes<HTMLElement>, "id" | "onToggle">;

export function Sidebar({
  collapsed: initial = false, storageKey, newSession, newSessionProps, recent = "Recent", empty = "No sessions yet", id,
  workspace, places = [], sessions = [], account, onToggle, className, ...rest
}: SidebarProps) {
  const auto = `sidebar-${useId().replace(/:/g, "")}`;
  const sidebarId = id ?? auto;
  const [collapsed, setCollapsed] = useState(initial);

  // With a key the choice is remembered; a stored choice wins over the default.
  useEffect(() => {
    if (!storageKey) return;
    try {
      const value = localStorage.getItem(storageKey);
      if (value != null) setCollapsed(value === "1");
    } catch {
      // Storage can be blocked; the default stands.
    }
  }, [storageKey]);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    if (storageKey)
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        // Storage can be blocked; the choice holds for the page.
      }
    onToggle?.(next);
  };

  return (
    <aside id={sidebarId} className={cx("ds-sidebar", className, { "is-collapsed": collapsed })} aria-label="Sidebar" {...rest}>
      {workspace && (
        <div className="ds-sidebar-head">
          <Menu
            items={workspace.items}
            label="Workspace menu"
            side="bottom"
            className="ds-sidebar-menu"
            header={
              <>
                <Tile name={workspace.name} src={workspace.src} size={24} current decorative />
                {workspace.name}
              </>
            }
            trigger={trigger(
              "ds-sidebar-ws",
              <Tile name={workspace.name} src={workspace.src} size={24} current decorative />,
              <span className="ds-sidebar-ws-name ds-sidebar-label">{workspace.name}</span>,
            )}
          />
        </div>
      )}
      {places.length > 0 && (
        <nav className="ds-sidebar-places" aria-label="Places">
          {places.map((place) => (
            <Tooltip key={place.label} text={place.label} side="right" className="ds-sidebar-tip">
              {placeTag(place)}
            </Tooltip>
          ))}
        </nav>
      )}
      {(sessions.length > 0 || newSession) && (
        <div className="ds-sidebar-recent">
          <div className="ds-sidebar-recent-head">
            <h2 className="ds-sidebar-recent-title ds-sidebar-label">{recent}</h2>
            {newSession && (
              <Tooltip text="New session" side="right">
                <Button variant="ghost" size="sm" glyph="plus" label="New session" href={newSession} {...newSessionProps} />
              </Tooltip>
            )}
          </div>
          <nav className="ds-sidebar-rows" aria-label="Sessions">
            {sessions.length > 0 ? (
              sessions.map((session, i) => <SidebarRow key={session.id ?? i} {...session} />)
            ) : (
              <p className="ds-sidebar-empty ds-sidebar-label">{empty}</p>
            )}
          </nav>
        </div>
      )}
      {account && (
        <div className="ds-sidebar-foot">
          <Menu
            items={account.items ?? []}
            label="Account"
            side="top"
            className="ds-sidebar-menu"
            trigger={trigger(
              "ds-sidebar-account",
              <Tile name={account.name} src={account.src} size={24} decorative />,
              <span className="ds-sidebar-me ds-sidebar-label">
                <span className="ds-sidebar-me-name">{account.name}</span>
                {account.email && <span className="ds-sidebar-me-mail">{account.email}</span>}
              </span>,
            )}
          />
        </div>
      )}
      <button
        type="button"
        className="ds-sidebar-toggle"
        aria-controls={sidebarId}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
        onClick={toggle}
      >
        <Glyph name="chevron-left" size={12} />
      </button>
    </aside>
  );
}

function trigger(css: string, lead: ReactNode, text: ReactNode) {
  return (
    <button type="button" className={css}>
      {lead}
      {text}
      <Glyph name="chevron-down" size={16} className="ds-sidebar-chevron" />
    </button>
  );
}

function placeTag({ label, icon, href, count, active = false, disabled = false }: SidebarPlace) {
  const face = <Glyph name={icon} size={20} />;
  const name = <span className="ds-sidebar-label">{label}</span>;
  const css = cx("ds-sidebar-place", { "is-active": active, "is-off": disabled });
  if (disabled) {
    return (
      <span className={css} aria-disabled aria-label={label}>
        {face}
        {name}
        <span className="ds-sidebar-end">{typeof disabled === "string" ? disabled : "Soon"}</span>
      </span>
    );
  }
  const inner = (
    <>
      {face}
      {name}
      {count != null && <Count value={count} className="ds-sidebar-end" />}
    </>
  );
  const props = { className: css, "aria-label": label, "aria-current": active ? ("page" as const) : undefined };
  return href && /^[a-z]+:/.test(href) ? (
    <a href={href} {...props}>
      {inner}
    </a>
  ) : (
    <Link to={href ?? ""} {...props}>
      {inner}
    </Link>
  );
}

// Ds::Sidebar::Row: one recent session in the sidebar: its state as a dot and a hidden word, the title, a meta line,
// and the title again as a tooltip for the rail. The id sits on the outermost element.
export type SidebarRowProps = {
  title: string;
  href: string;
  state?: "ok" | "busy" | "bad" | "idle";
  word?: string;
  meta?: ReactNode;
  active?: boolean;
  id?: string;
  className?: string;
};

export function SidebarRow({ title, href, state = "idle", word, meta, active = false, id, className }: SidebarRowProps) {
  const auto = `ds-sidebar-row-${useId().replace(/:/g, "")}`;
  const metaId = `${id ?? auto}-meta`;
  const props = {
    className: cx("ds-sidebar-row", { "is-active": active }),
    "aria-label": title,
    "aria-describedby": metaId,
    "aria-current": active ? ("page" as const) : undefined,
  };
  const inner = (
    <>
      <span className={`ds-sidebar-dot is-${state}`} title={word} aria-hidden />
      <span className="ds-sidebar-row-text ds-sidebar-label">
        <span className="ds-sidebar-row-title">{title}</span>
        <span className="ds-sidebar-row-meta" id={metaId}>
          {word && <span className="ds-sidebar-word">{`${word}, `}</span>}
          {meta}
        </span>
      </span>
    </>
  );
  return (
    <Tooltip text={title} side="right" className={cx("ds-sidebar-tip", className)} id={id}>
      {/^[a-z]+:/.test(href) ? (
        <a href={href} {...props}>
          {inner}
        </a>
      ) : (
        <Link to={href} {...props}>
          {inner}
        </Link>
      )}
    </Tooltip>
  );
}
