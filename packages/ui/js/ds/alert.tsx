import type { HTMLAttributes, ReactNode } from "react";
import { Check, CircleAlert, Info } from "lucide-react";
import { Link } from "react-router";
import { cx } from "./cx";
import { Glyph } from "./glyph";

// The glyph in the signal cell, per tone: vrcl's letter-i, exclamation and check.
const MARKS = { info: Info, warning: CircleAlert, error: CircleAlert, success: Check };

// Ds::Alert: a message in the page, a square box, a round signal cell, an optional title, the words and one
// action. `errors` makes it the summary above a form, each message linking to its field: [message, field id?].
export type AlertProps = {
  tone?: "info" | "warning" | "error" | "success";
  title?: ReactNode;
  errors?: [ReactNode, string?][];
  action?: ReactNode;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "children" | "title">;

export function Alert({ tone = "info", title, errors, action, className, children, ...rest }: AlertProps) {
  const heading = title || (errors && `${errors.length} ${errors.length === 1 ? "thing" : "things"} to fix`);
  return (
    <div
      className={cx("ds-alert", `is-${tone}`, className, { "is-summary": errors })}
      role={tone === "error" || errors ? "alert" : "status"}
      tabIndex={errors ? -1 : undefined}
      {...rest}
    >
      <span className="ds-alert-mark" aria-hidden="true">
        <Glyph name={MARKS[tone]} size={12} />
      </span>
      <div className="ds-alert-words">
        {heading && <p className="ds-alert-title">{heading}</p>}
        {children != null && children !== false && <div className="ds-alert-text">{children}</div>}
        {errors && (
          <ul className="ds-alert-list">
            {errors.map(([message, field], i) => (
              <li key={i}>{field ? <Link to={`#${field}`}>{message}</Link> : message}</li>
            ))}
          </ul>
        )}
      </div>
      {action && <div className="ds-alert-action">{action}</div>}
    </div>
  );
}
