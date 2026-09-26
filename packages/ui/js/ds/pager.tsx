import { Link } from "react-router";
import { cx } from "./cx";

// Ds::Pager: previous and next pages at the foot of a page. Each is [title, href] or nothing.
export type PagerProps = { previous?: [string, string] | null; nextPage?: [string, string] | null };

function PagerLink({ label, page: [title, href], forward }: { label: string; page: [string, string]; forward: boolean }) {
  return (
    <Link to={href} className={cx("ds-pager-link", { "is-next": forward })}>
      <span>{label}</span>
      <b>{title}</b>
    </Link>
  );
}

export function Pager({ previous, nextPage }: PagerProps) {
  return (
    <nav className="ds-pager" aria-label="Pages">
      {previous ? <PagerLink label="Previous" page={previous} forward={false} /> : <span />}
      {nextPage && <PagerLink label="Next" page={nextPage} forward />}
    </nav>
  );
}
