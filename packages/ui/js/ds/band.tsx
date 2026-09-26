import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

// Ds::Band: a full-width band of a marketing page: a mono kicker, a headline, a lead, then its content.
export type BandProps = {
  title?: ReactNode;
  kicker?: ReactNode;
  lead?: ReactNode;
  tone?: "paper" | "white";
  slim?: boolean;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children" | "title">;

export function Band({ title, kicker, lead, tone = "white", slim = false, className, children, ...rest }: BandProps) {
  return (
    <section className={cx("ds-band", `is-${tone}`, { "is-slim": slim }, className)} {...rest}>
      <div className="ds-band-in">
        {kicker && <span className="ds-band-kicker">{kicker}</span>}
        {title && <h2>{title}</h2>}
        {lead && <p className="ds-band-lead">{lead}</p>}
        {children != null && children !== false && <div className={cx("ds-band-body", { "is-bare": !title })}>{children}</div>}
      </div>
    </section>
  );
}
