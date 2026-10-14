import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { Link } from "react-router";
import { Icon } from "./icon";

// Ds::Card: a white card with an ink edge on a marketing page, a face at 48, a title, a line.
export type CardProps = {
  title: ReactNode;
  icon?: ComponentProps<typeof Icon>["name"];
  text?: ReactNode;
  href?: string;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children" | "title">;

export function Card({ title, icon, text, href, children, ...rest }: CardProps) {
  const body = (
    <>
      {icon && <Icon name={icon} size={48} />}
      <b className="ds-card-title">{title}</b>
      {text && <p className="ds-card-text">{text}</p>}
      {children}
    </>
  );
  if (href)
    return (
      <Link to={href} className="ds-card is-link" {...rest}>
        {body}
      </Link>
    );
  return (
    <div className="ds-card" {...rest}>
      {body}
    </div>
  );
}
