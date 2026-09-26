import { Fragment, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

// Ds::Meta: the facts after a row's title, joined by a middle dot; nulls are dropped.
export type MetaProps = { parts: ReactNode[] } & Omit<HTMLAttributes<HTMLSpanElement>, "children">;

export function Meta({ parts, className, ...rest }: MetaProps) {
  const items = parts.filter((part) => part != null);
  return (
    <span className={cx("ds-meta", className)} {...rest}>
      {items.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <span className="ds-meta-dot" aria-hidden="true">
              {" · "}
            </span>
          )}
          <span className="ds-meta-part">{part}</span>
        </Fragment>
      ))}
    </span>
  );
}

// A diff as two numbers: additions in green, removals in red.
export function MetaDiff({ added, removed }: { added: number; removed: number }) {
  return (
    <>
      <span className="ds-meta-add">+{added}</span> <span className="ds-meta-del">−{removed}</span>
    </>
  );
}
