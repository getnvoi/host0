import { Link } from "react-router";
import { cx } from "./cx";

// Ds::SideNav: grouped links down the side of a public page. groups: { "Label": [[title, href, current], ...] }.
export type SideNavProps = { groups: Record<string, [string, string, boolean?][]>; label?: string };

export function SideNav({ groups, label = "Pages" }: SideNavProps) {
  return (
    <nav className="ds-side-nav" aria-label={label}>
      {Object.entries(groups).map(([group, links]) => (
        <div className="ds-side-nav-group" key={group}>
          <span className="ds-side-nav-label">{group}</span>
          {links.map(([title, href, current]) => {
            const props = { className: cx("ds-side-nav-item", { "is-on": current }), "aria-current": current ? ("page" as const) : undefined };
            return /^[a-z]+:/.test(href) ? (
              <a key={href} href={href} {...props}>{title}</a>
            ) : (
              <Link key={href} to={href} {...props}>{title}</Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
