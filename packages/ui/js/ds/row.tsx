import type { HTMLAttributes, ReactNode } from "react";
import { Link } from "react-router";
import { cx } from "./cx";
import { Meta } from "./meta";
import { Text } from "./text";

// Ds::Row: one line of a list or a card, a leading mark, an optional mono name, the title, the meta and a trail.
export type RowProps = {
  title: string;
  name?: ReactNode;
  scope?: ReactNode;
  meta?: ReactNode | ReactNode[];
  href?: string;
  stack?: boolean;
  divider?: boolean;
  lead?: ReactNode;
  trail?: ReactNode;
  // A second thing to do with the same item, after a linked row, outside its link.
  action?: ReactNode;
  // The one chosen in a list; `off`, one that cannot be chosen, dimmed, never a link.
  current?: boolean;
  off?: boolean;
} & Omit<HTMLAttributes<HTMLElement>, "children" | "title">;

export function Row({ title, name, scope, meta, href: target, stack = false, divider = true, lead, trail, action, current = false, off = false, className, ...rest }: RowProps) {
  const href = off ? undefined : target;
  const mark = lead && <span className="ds-lead">{lead}</span>;
  const facts = meta != null && <Meta parts={Array.isArray(meta) ? meta : [meta]} />;
  const parts = stack ? (
    <>
      <span className="ds-row-title" title={title}>
        {title}
      </span>
      <span className="ds-row-foot">
        {mark}
        <span className="ds-row-name">
          {scope && <span className="ds-row-scope">{scope}</span>}
          {name && <span>{name}</span>}
        </span>
        {facts}
        {trail}
      </span>
    </>
  ) : (
    <>
      {mark}
      {name && <Text as="name">{name}</Text>}
      <Text as="body" truncate grow title={title}>
        {title}
      </Text>
      {facts}
      {trail}
    </>
  );
  const classes = cx("ds-row", className, { "has-divider": divider, "is-link": href, "is-stack": stack, "is-current": current, "is-off": off });
  if (href && action)
    return (
      <div className={cx(classes, "has-action")}>
        <Link to={href} className="ds-row-link" {...rest}>
          {parts}
        </Link>
        <span className="ds-row-action">{action}</span>
      </div>
    );
  if (href)
    return (
      <Link to={href} className={classes} {...rest}>
        {parts}
      </Link>
    );
  return (
    <div className={classes} {...rest}>
      {parts}
    </div>
  );
}
