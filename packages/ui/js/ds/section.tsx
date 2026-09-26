import { useId, type ComponentProps, type ElementType, type HTMLAttributes, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "./badge";
import { Button } from "./button";
import { Count } from "./count";
import { cx } from "./cx";
import { FAMILY, Icon } from "./icon";
import { Menu, type MenuItem } from "./menu";
import { Tile } from "./tile";

// Ds::Section: a label tab over a box. The tab names the section in mono; `flush` drops the box's padding for rows
// that run edge to edge; `badges` mark its kinds and `menu` holds what acts on the whole section.
export type SectionProps = {
  name: string;
  icon?: ComponentProps<typeof Icon>["name"];
  family?: string;
  // A thing's tile: its name, or { name, src } for a picture.
  tile?: string | { name: string; src?: string };
  count?: number;
  // A state drawn as a dot in the tab's cell, for a section that is a state: a board's lane.
  dot?: "ok" | "busy" | "bad" | "idle";
  // Kind badges: strings, or { label, glyph }.
  badges?: (string | { label: ReactNode; glyph?: string | LucideIcon })[];
  menu?: MenuItem[];
  text?: ReactNode;
  signed?: boolean;
  flush?: boolean;
  // A grey ground for cards laid on it, as a board's lane holds its cards.
  ground?: boolean;
  heading?: ElementType;
  id?: string;
  action?: ReactNode;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children" | "id">;

export function Section({
  name,
  icon,
  family,
  tile,
  count,
  dot,
  badges = [],
  menu = [],
  text,
  signed = false,
  flush = false,
  ground = false,
  heading: Heading = "h2",
  id,
  action,
  className,
  children,
  ...rest
}: SectionProps) {
  const auto = `section-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${useId().replace(/:/g, "")}`;
  const key = id ?? auto;
  const tint = family || (icon && ((typeof icon === "string" && FAMILY[icon]) || "gray"));
  const classes = cx("ds-section", className, {
    [`ds-f-${tint}`]: tint,
    "is-signed": signed,
    "is-flush": flush,
    "is-ground": ground,
    "has-icon": icon || dot,
  });
  const spec = typeof tile === "string" ? { name: tile } : tile;
  const hasEnds = badges.length > 0 || menu.length > 0;
  // Badges and menu, where they go: on the text line when there is one.
  const ends = hasEnds && (
    <>
      {badges.map((badge, i) => {
        const b = typeof badge === "string" ? { label: badge } : badge;
        return (
          <Badge key={i} kind glyph={b.glyph}>
            {b.label}
          </Badge>
        );
      })}
      {menu.length > 0 && (
        <Menu align="end" items={menu} trigger={<Button variant="ghost" size="sm" glyph="more-horizontal" label={`Actions for ${name}`} />} />
      )}
    </>
  );
  const hasBody = children != null && children !== false;

  return (
    <section className={classes} aria-labelledby={key} {...rest}>
      <div className="ds-section-bar">
        <div className="ds-section-tab">
          {icon ? (
            <span className="ds-section-icon">
              <Icon name={icon} size={20} />
            </span>
          ) : (
            dot && (
              <span className="ds-section-icon">
                <span className={`ds-section-dot is-${dot}`} aria-hidden="true" />
              </span>
            )
          )}
          {spec && (
            <span className="ds-section-tile">
              <Tile size={20} decorative {...spec} />
            </span>
          )}
          <Heading className="ds-section-name" id={key}>
            {name}
            {count != null && <Count value={count} />}
          </Heading>
        </div>
        {(action || (hasEnds && !text)) && (
          <div className="ds-section-action">
            {!text && ends}
            {action}
          </div>
        )}
      </div>
      <div className="ds-section-box">
        {text && hasEnds ? (
          <div className="ds-section-line">
            <p className="ds-section-text">{text}</p>
            <span className="ds-section-end">{ends}</span>
          </div>
        ) : (
          text && <p className="ds-section-text">{text}</p>
        )}
        {hasBody && <div className="ds-section-body">{children}</div>}
      </div>
    </section>
  );
}
