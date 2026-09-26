import type { HTMLAttributes } from "react";
import { Link } from "react-router";
import { cx } from "./cx";

// Ds::Breadcrumbs: where a public page sits; every part links but the last, which is the page itself.
export type BreadcrumbsProps = { items: [string, string?][] } & Omit<HTMLAttributes<HTMLElement>, "children">;

export function Breadcrumbs({ items, className, ...rest }: BreadcrumbsProps) {
  return (
    <nav className={cx("ds-breadcrumbs", className)} aria-label="Breadcrumb" {...rest}>
      <ol className="ds-breadcrumbs-in">
        {items.map(([label, href], i) => (
          <li key={i} className="ds-breadcrumbs-part">
            {i === items.length - 1 ? <span aria-current="page">{label}</span> : <Link to={href ?? ""}>{label}</Link>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
