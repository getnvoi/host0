import { useEffect, useRef, useState, type AnchorHTMLAttributes, type HTMLAttributes, type KeyboardEvent } from "react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router";
import { cx } from "./cx";
import { Glyph } from "./glyph";

export type SegmentedItem = {
  value?: string;
  label: string;
  glyph?: string | LucideIcon;
  href?: string;
  disabled?: boolean;
  // Attributes for the item's link.
  attrs?: AnchorHTMLAttributes<HTMLAnchorElement>;
};

// Ds::Segmented: two to four views of the same thing on a round track; the chosen one is lifted onto white.
// With `href` items each is a link; otherwise the items are radios, `name` keeps the value in a hidden input and
// `submit` sends the form on a pick.
export type SegmentedProps = {
  items: SegmentedItem[];
  value: string;
  name?: string;
  submit?: boolean;
  label?: string;
  glyphOnly?: boolean;
  fold?: boolean;
  size?: "md" | "sm";
  disabled?: boolean;
  onChange?: (value: string) => void;
} & Omit<HTMLAttributes<HTMLElement>, "children" | "onChange">;

export function Segmented({
  items,
  value,
  name,
  submit = false,
  label,
  glyphOnly = false,
  fold = false,
  size = "md",
  disabled = false,
  onChange,
  className,
  ...rest
}: SegmentedProps) {
  const [chosen, setChosen] = useState(value);
  useEffect(() => setChosen(value), [value]);
  const root = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const classes = cx("ds-segmented", `is-${size}`, className, {
    "is-glyph": glyphOnly,
    "is-fold": fold && !glyphOnly,
    "is-disabled": disabled,
  });
  const off = (item: SegmentedItem) => disabled || item.disabled;
  const isChosen = (item: SegmentedItem, current: string) => String(item.value) === String(current);
  const named = (item: SegmentedItem) => {
    if (glyphOnly) return { "aria-label": item.label, title: item.label };
    return fold && item.glyph ? { title: item.label } : {};
  };
  const inner = (item: SegmentedItem) => (
    <>
      {item.glyph && <Glyph name={item.glyph} size={size === "sm" ? 12 : 14} />}
      {!glyphOnly && <span className="ds-segmented-label">{item.label}</span>}
    </>
  );

  if (items.some((item) => item.href)) {
    return (
      <nav className={classes} aria-label={label} {...rest}>
        {items.map((item, i) => {
          const itemClasses = cx("ds-segmented-item", { "is-chosen": isChosen(item, value) });
          if (off(item))
            return (
              <span key={i} className={itemClasses} aria-disabled="true" {...named(item)}>
                {inner(item)}
              </span>
            );
          return (
            <Link key={i} to={item.href ?? ""} className={itemClasses} aria-current={isChosen(item, value) ? "page" : undefined} {...named(item)} {...item.attrs}>
              {inner(item)}
            </Link>
          );
        })}
      </nav>
    );
  }

  // A click or an arrow key picks, the hidden input keeps the value, and with `submit` the pick sends the form.
  const choose = (item: SegmentedItem) => {
    const next = String(item.value);
    if (next === String(chosen)) return;
    setChosen(next);
    onChange?.(next);
    if (submit) {
      const form = root.current?.closest("form");
      // The hidden input takes the new value on render; send once it has.
      if (form) setTimeout(() => form.requestSubmit());
    }
  };

  const key = (event: KeyboardEvent<HTMLButtonElement>, at: number) => {
    const steps: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const open = items.map((item, i) => i).filter((i) => !off(items[i]));
    let next: number | undefined;
    if (event.key in steps) {
      const here = open.indexOf(at);
      next = open[(here + steps[event.key] + open.length) % open.length];
    } else if (event.key === "Home") next = open[0];
    else if (event.key === "End") next = open[open.length - 1];
    if (next === undefined) return;
    event.preventDefault();
    buttons.current[next]?.focus();
    choose(items[next]);
  };

  return (
    <div ref={root} className={classes} role="radiogroup" aria-label={label} data-submit={submit || undefined} {...rest}>
      {name && <input type="hidden" name={name} value={chosen} />}
      {items.map((item, i) => {
        const on = isChosen(item, chosen);
        return (
          <button
            key={i}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            role="radio"
            className={cx("ds-segmented-item", { "is-chosen": on })}
            aria-checked={on ? "true" : "false"}
            tabIndex={on ? 0 : -1}
            disabled={off(item) || undefined}
            data-value={item.value}
            onClick={() => choose(item)}
            onKeyDown={(event) => key(event, i)}
            {...named(item)}
          >
            {inner(item)}
          </button>
        );
      })}
    </div>
  );
}
