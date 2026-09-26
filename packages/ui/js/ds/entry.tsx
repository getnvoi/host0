import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { Link } from "react-router";
import { Badge } from "./badge";
import { cx } from "./cx";
import { Prose } from "./prose";

const KINDS = { New: "green", Changed: "blue", Fixed: "amber" } as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Ds::Entry: one changelog entry, its date and kind down the left, then the title, what changed, a screen and links.
export type EntryProps = {
  id: string;
  title: ReactNode;
  // A calendar date, as YYYY-MM-DD or a Date.
  date: string | Date;
  kind: keyof typeof KINDS;
  links?: [string, string][];
  heading?: ElementType;
  screen?: ReactNode;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children" | "title" | "id">;

export function Entry({ id, title, date, kind, links = [], heading: Heading = "h3", screen, className, children, ...rest }: EntryProps) {
  const [y, m, d] = (typeof date === "string" ? date : date.toISOString()).slice(0, 10).split("-").map(Number);
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return (
    <article id={id} className={cx("ds-entry", className)} {...rest}>
      <div className="ds-entry-side">
        <time className="ds-entry-date" dateTime={iso}>{`${d} ${MONTHS[m - 1]} ${y}`}</time>
        <Badge family={KINDS[kind]}>{kind}</Badge>
      </div>
      <div className="ds-entry-main">
        <Heading className="ds-entry-title">
          <a href={`#${id}`}>{title}</a>
        </Heading>
        <Prose className="ds-entry-body">{children}</Prose>
        {screen && <div className="ds-entry-screen">{screen}</div>}
        {links.length > 0 && (
          <p className="ds-entry-links">
            {links.map(([label, href], i) => (
              <Link key={i} to={href}>
                {label}
              </Link>
            ))}
          </p>
        )}
      </div>
    </article>
  );
}
