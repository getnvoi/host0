import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { Link } from "react-router";
import { cx } from "./cx";
import { Icon } from "./icon";

const WORDS = { ok: "Done", busy: "Running", bad: "Failed" };

export type TabsItem = {
  label: ReactNode;
  href: string;
  icon?: ComponentProps<typeof Icon>["name"];
  number?: ReactNode;
  mono?: boolean;
  state?: "ok" | "busy" | "bad";
  word?: string;
  current?: boolean;
};

// Ds::Tabs: the conversations of a session as tabs, links under the head, the one in view underlined. "separator"
// draws a rule between groups.
export type TabsProps = { items: (TabsItem | "separator" | null | undefined)[]; label?: string } & Omit<HTMLAttributes<HTMLElement>, "children">;

export function Tabs({ items, label = "Conversations", className, ...rest }: TabsProps) {
  return (
    <nav className={cx("ds-tabs", className)} aria-label={label} {...rest}>
      {items.map((item, i) => {
        if (item == null) return null;
        if (item === "separator") return <span key={i} className="ds-tabs-rule" />;
        return (
          <Link key={i} to={item.href} className={cx("ds-tabs-tab", { "is-current": item.current })} aria-current={item.current ? "page" : undefined}>
            {item.icon && <Icon name={item.icon} size={18} />}
            {item.number != null && <span className="ds-tabs-number">{item.number}</span>}
            <span className={cx("ds-tabs-label", { "is-mono": item.mono })}>{item.label}</span>
            {/* The dot and the word after the label: colour alone never carries the state. */}
            {item.state && <span className={`ds-tabs-dot is-${item.state}`} aria-hidden="true" />}
            {item.state && <span className="ds-tabs-word">{item.word || WORDS[item.state]}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
