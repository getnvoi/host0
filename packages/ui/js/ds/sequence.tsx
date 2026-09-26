import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { Link } from "react-router";
import { cx } from "./cx";
import { Icon } from "./icon";

export type SequenceStep = { title: ReactNode; text: ReactNode; icon?: ComponentProps<typeof Icon>["name"]; href?: string };

// Ds::Sequence: how something happens, in order, on a public page, numbered boxes with an ink edge, one step each.
export type SequenceProps = { steps: SequenceStep[]; label?: string } & Omit<HTMLAttributes<HTMLOListElement>, "children">;

export function Sequence({ steps, label, className, ...rest }: SequenceProps) {
  return (
    <ol className={cx("ds-sequence", className)} aria-label={label} {...rest}>
      {steps.map((step, i) => (
        <li key={i} className="ds-sequence-step">
          <span className="ds-sequence-number" aria-hidden="true">
            {String(i + 1).padStart(2, "0")}
          </span>
          {step.icon && <Icon name={step.icon} size={48} />}
          <b className="ds-sequence-title">
            {step.href ? (
              <Link to={step.href} className="ds-sequence-link">
                {step.title}
              </Link>
            ) : (
              step.title
            )}
          </b>
          <p className="ds-sequence-text">{step.text}</p>
        </li>
      ))}
    </ol>
  );
}
