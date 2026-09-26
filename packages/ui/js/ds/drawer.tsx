import { useRef, type CSSProperties, type DialogHTMLAttributes, type ReactNode } from "react";
import { Button } from "./button";
import { cx } from "./cx";
import { useModal } from "./dialog";

// Ds::Drawer: a panel from the side of the window, for what is read at length beside the page: logs, a run's output.
// The same native modal as the dialog, with the same close rules.
export type DrawerProps = {
  id: string;
  title: ReactNode;
  text?: ReactNode;
  side?: "right" | "left";
  width?: number;
  // Body without padding, for a log or a list that runs edge to edge.
  flush?: boolean;
  open?: boolean;
  // Controls in the head, before the close button.
  actions?: ReactNode;
  foot?: ReactNode;
  onClose?: () => void;
} & Omit<DialogHTMLAttributes<HTMLDialogElement>, "id" | "title" | "open" | "onClose">;

export function Drawer({ id, title, text, side = "right", width = 640, flush = false, open = false, actions, foot, onClose, className, style, children, ...rest }: DrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const modal = useModal(ref, open);
  return (
    <dialog
      ref={ref}
      id={id}
      className={cx("ds-drawer", `is-${side}`, className)}
      style={{ "--w": `${width}px`, ...style } as CSSProperties}
      aria-labelledby={`${id}-title`}
      aria-describedby={text ? `${id}-text` : undefined}
      onPointerDown={modal.onPointerDown}
      onClick={modal.onClick}
      onClose={onClose}
      {...rest}
    >
      <div className="ds-drawer-head">
        <span className="ds-drawer-heading">
          <b className="ds-drawer-title" id={`${id}-title`}>
            {title}
          </b>
          {text && (
            <span className="ds-drawer-text" id={`${id}-text`}>
              {text}
            </span>
          )}
        </span>
        {actions && <span className="ds-drawer-actions">{actions}</span>}
        <Button size="sm" glyph="close" label="Close" onClick={modal.close} />
      </div>
      <div className={cx("ds-drawer-body", { "is-flush": flush })}>{children}</div>
      {foot && <div className="ds-drawer-foot">{foot}</div>}
    </dialog>
  );
}
