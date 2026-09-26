import {
  Children,
  createContext,
  isValidElement,
  useContext,
  type ComponentProps,
  type CSSProperties,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { Link } from "react-router";
import { Count } from "./count";
import { cx } from "./cx";
import { Glyph } from "./glyph";
import { FAMILY, Icon } from "./icon";
import { Tile } from "./tile";

const Tracks = createContext("");
const Owner = createContext<{ href?: string; off: boolean }>({ off: false });

type State = "ok" | "busy" | "bad" | "idle";

// Ds::List::Name: the first cell of a list row, a mark, the name in 500 and a line under it; with the row's href
// the name is the link.
export type ListNameProps = {
  title: ReactNode;
  text?: ReactNode;
  icon?: ComponentProps<typeof Icon>["name"];
  tile?: string | true;
  // A state as the mark: [state, word], a dot that says its word to screen readers and on hover.
  state?: [State, string];
  mono?: boolean;
  textIcon?: ComponentProps<typeof Icon>["name"];
  textState?: State;
  href?: string;
  off?: boolean;
  children?: ReactNode;
};

export function ListName(props: ListNameProps) {
  const row = useContext(Owner);
  const { title, text, icon, tile, state, mono = false, textIcon, textState, href = row.href, off = row.off, children } = props;
  let mark: ReactNode = null;
  if (state) {
    const [kind, word] = state;
    mark = <span className={`ds-list-dot is-${kind}`} role="img" aria-label={word} title={word} />;
  } else if (icon) {
    const family = off ? "off" : (typeof icon === "string" && FAMILY[icon]) || "gray";
    mark = <Icon name={icon} size={24} family={family} />;
  } else if (tile) {
    mark = <Tile name={tile === true ? String(title) : tile} size={24} off={off} />;
  }
  return (
    <div className="ds-list-cell ds-list-name" role="cell">
      {mark && <span className="ds-lead">{mark}</span>}
      <span className="ds-list-words">
        {href ? (
          <Link to={href} className="ds-list-title ds-list-link">
            {title}
          </Link>
        ) : (
          <span className="ds-list-title">{title}</span>
        )}
        {text && (
          <span className={cx("ds-list-text", { "is-mono": mono, "has-icon": textIcon || textState })}>
            {textIcon && <Icon name={textIcon} size={14} />}
            {textState && <span className={`ds-list-dot is-${textState}`} aria-hidden="true" />}
            {text}
          </span>
        )}
      </span>
      {children}
    </div>
  );
}

// Ds::List cell: one cell of a list row; `mono` for a cell that holds a thing's name or size.
export function ListCell({ align, mono = false, children }: { align?: "end"; mono?: boolean; children?: ReactNode }) {
  return (
    <div className={cx("ds-list-cell", { "is-end": align === "end", "is-mono": mono })} role="cell">
      {children}
    </div>
  );
}

// Ds::List::Row: one row of a list; cells come in order, the name, then each cell, then the menu. With `detail` the
// row folds, a disclosure rather than a link.
export type ListRowProps = {
  href?: string;
  off?: boolean;
  disabled?: boolean;
  id?: string;
  // The label of the run of rows this one belongs to: Today, Yesterday.
  group?: string;
  name?: ReactNode;
  cells?: ReactNode;
  menu?: ReactNode;
  detail?: ReactNode;
  open?: boolean;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children" | "id">;

export function ListRow({ href, off = false, disabled = false, id, group: _group, name, cells, menu, detail, open = false, className, children, ...rest }: ListRowProps) {
  const tracks = useContext(Tracks);
  const link = disabled || detail ? undefined : href;
  const dim = off || disabled;
  const classes = cx("ds-list-row", className, { "is-link": link, "is-off": dim, "is-disabled": disabled });
  const style = { "--tracks": tracks } as CSSProperties;
  const named = <Owner.Provider value={{ href: link, off: dim }}>{name}</Owner.Provider>;
  if (detail) {
    // A details element: the row is its summary, the chevron its last cell.
    return (
      <details id={id} open={open} className="ds-list-fold" {...rest}>
        <summary role="row" className={cx(classes, "is-fold")} style={style}>
          {named}
          {cells}
          <div className="ds-list-cell ds-list-chevron" role="cell">
            <Glyph name="chevron-right" size={14} />
          </div>
        </summary>
        <div className="ds-list-detail">{detail}</div>
      </details>
    );
  }
  return (
    <div id={id} role="row" className={classes} style={style} aria-disabled={disabled ? true : undefined} {...rest}>
      {named}
      {cells}
      {menu && (
        <div className="ds-list-cell ds-list-menu" role="cell">
          {menu}
        </div>
      )}
      {children}
    </div>
  );
}

// Ds::List: a head of captions, then rows split by g6 dividers, on one grid. Rows are ListRow children; rows that
// share a `group` run under one group line with its count. With no rows `empty` replaces the head and the rows.
export type ListProps = {
  columns: (ReactNode | [ReactNode, "end"])[];
  template?: string;
  head?: boolean;
  dense?: boolean;
  label?: string;
  empty?: ReactNode;
  foot?: ReactNode;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">;

export function List({ columns, template, head = true, dense = false, label, empty, foot, className, children, ...rest }: ListProps) {
  const tracks = template || `repeat(${columns.length}, minmax(0, 1fr))`;
  const rows = Children.toArray(children).filter(isValidElement) as ReactElement<ListRowProps>[];
  if (rows.length === 0 && empty)
    return (
      <div className={cx("ds-list", "is-empty", className)} {...rest}>
        {empty}
      </div>
    );

  // One rowgroup, or one per run of rows that share a group, each after its group line.
  const runs: ReactElement<ListRowProps>[][] = [];
  if (rows.some((row) => row.props.group)) {
    for (const row of rows) {
      const last = runs[runs.length - 1];
      if (last && last[0].props.group === row.props.group) last.push(row);
      else runs.push([row]);
    }
  }

  return (
    <Tracks.Provider value={tracks}>
      <div role="table" aria-label={label} className={cx("ds-list", className, { "is-dense": dense })} {...rest}>
        {head && (
          <div role="rowgroup">
            <div className="ds-list-head" role="row" style={{ "--tracks": tracks } as CSSProperties}>
              {columns.map((column, i) => {
                const [text, align] = Array.isArray(column) ? column : [column, undefined];
                const blank = text == null || text === "";
                return (
                  <span key={i} role="columnheader" className={cx("ds-list-caption", { "is-end": align === "end" })} aria-label={blank ? "Actions" : undefined}>
                    {text}
                  </span>
                );
              })}
            </div>
          </div>
        )}
        {runs.length === 0 ? (
          <div role="rowgroup">{rows}</div>
        ) : (
          runs.map((run, i) => (
            <div key={i} role="rowgroup" className="ds-list-run">
              <div className="ds-list-group" role="row">
                <span role="rowheader" aria-colspan={columns.length} className="ds-list-group-label">
                  {run[0].props.group}
                  <Count value={run.length} />
                </span>
              </div>
              {run}
            </div>
          ))
        )}
        {foot && <div className="ds-list-foot">{foot}</div>}
      </div>
    </Tracks.Provider>
  );
}
