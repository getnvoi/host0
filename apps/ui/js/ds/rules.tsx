import type { ReactNode } from "react";

// Ds::Rules: do and don't side by side. Each rule is [kind, what is shown, text].
export type RulesProps = { rules: ["do" | "dont", ReactNode, ReactNode][] };

export function Rules({ rules }: RulesProps) {
  return (
    <div className="ds-rules">
      {rules.map(([kind, stage, text], i) => (
        <figure key={i} className={`ds-rule is-${kind}`}>
          <div className="ds-rule-stage">{stage}</div>
          <figcaption>
            <b>{kind === "do" ? "Do" : "Don't"}</b>
            <span>{text}</span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
