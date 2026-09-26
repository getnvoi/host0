import {
  useEffect, useRef, type DialogHTMLAttributes, type FormHTMLAttributes, type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject,
} from "react";
import { Button } from "./button";
import { cx } from "./cx";

// A native modal <dialog>: showModal traps focus, Escape closes, close hands focus back. This adds what the element
// does not do alone: a click on the backdrop closes (only when the press also started there, so a drag out of a field
// does not), a confirmation focuses its cancel, and commandfor works where the browser does not know it yet. The
// drawer and the lightbox use it too.
export function useModal(ref: RefObject<HTMLDialogElement | null>, open: boolean) {
  const pressed = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const focus = (event: Event) => {
      if ((event as ToggleEvent).newState !== "open") return;
      if (dialog.querySelector("[autofocus]")) return;
      if (dialog.getAttribute("role") === "alertdialog") dialog.querySelector<HTMLElement>(".ds-dialog-foot button")?.focus();
    };
    dialog.addEventListener("toggle", focus);
    let invoke: ((event: MouseEvent) => void) | undefined;
    if (!("commandForElement" in HTMLButtonElement.prototype)) {
      invoke = (event) => {
        const button = (event.target as Element | null)?.closest?.(`[commandfor="${dialog.id}"]`);
        if (!button || !dialog.id) return;
        if (button.getAttribute("command") === "show-modal" && !dialog.open) dialog.showModal();
        if (button.getAttribute("command") === "close") dialog.close();
      };
      document.addEventListener("click", invoke);
    }
    return () => {
      dialog.removeEventListener("toggle", focus);
      if (invoke) document.removeEventListener("click", invoke);
    };
  }, [ref]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [ref, open]);

  return {
    close: () => ref.current?.close(),
    onPointerDown: (event: ReactPointerEvent<HTMLDialogElement>) => {
      pressed.current = event.target === ref.current;
    },
    // The panel fills the element edge to edge, so a click whose target is the element itself landed on the backdrop.
    onClick: (event: ReactMouseEvent<HTMLDialogElement>) => {
      if (event.target === ref.current && pressed.current) ref.current?.close();
      pressed.current = false;
    },
  };
}

// Ds::Dialog: a square panel over a washed page, on a native modal <dialog>. Anything opens it with
// commandfor="<id>" command="show-modal", or the `open` prop. `bleed` lays a flow out edge to edge under a head that
// holds the title and its band; `fixed` keeps one height across the flow's steps.
export type DialogProps = {
  id: string;
  title: ReactNode;
  text?: ReactNode;
  size?: "sm" | "md" | "lg";
  // A confirmation interrupts: it is an alertdialog and its cancel takes focus first.
  alert?: boolean;
  // Attributes for a <form> around body and foot; method "dialog" closes on submit.
  form?: FormHTMLAttributes<HTMLFormElement>;
  open?: boolean;
  foot?: ReactNode;
  band?: ReactNode;
  bleed?: boolean;
  fixed?: boolean;
  onClose?: () => void;
} & Omit<DialogHTMLAttributes<HTMLDialogElement>, "id" | "title" | "open" | "onClose">;

export function Dialog({
  id, title, text, size = "sm", alert = false, form, open = false, foot, band, bleed = false, fixed = false, onClose, className, children, ...rest
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const modal = useModal(ref, open);
  const heading = (
    <>
      <div className="ds-dialog-title" id={`${id}-title`} role="heading" aria-level={2}>
        {title}
      </div>
      {text && (
        <p className="ds-dialog-text" id={`${id}-text`}>
          {text}
        </p>
      )}
    </>
  );
  const inner = bleed ? (
    <>
      <div className="ds-dialog-head">
        {heading}
        {band && <div className="ds-dialog-band">{band}</div>}
      </div>
      <div className="ds-dialog-body">{children && <div className="ds-dialog-content">{children}</div>}</div>
      {foot && <div className="ds-dialog-foot">{foot}</div>}
    </>
  ) : (
    <>
      <div className="ds-dialog-body">
        <div className="ds-dialog-title" id={`${id}-title`} role="heading" aria-level={2}>
          {title}
        </div>
        {text && (
          <p className="ds-dialog-text" id={`${id}-text`}>
            {text}
          </p>
        )}
        {children && <div className="ds-dialog-content">{children}</div>}
      </div>
      {foot && <div className="ds-dialog-foot">{foot}</div>}
    </>
  );
  return (
    <dialog
      ref={ref}
      id={id}
      className={cx("ds-dialog", `is-${size}`, className, { "is-bleed": bleed, "is-fixed": fixed })}
      role={alert ? "alertdialog" : undefined}
      aria-labelledby={`${id}-title`}
      aria-describedby={text ? `${id}-text` : undefined}
      onPointerDown={modal.onPointerDown}
      onClick={modal.onClick}
      onClose={onClose}
      {...rest}
    >
      {form ? (
        <form className="ds-dialog-inner" {...form}>
          {inner}
        </form>
      ) : (
        <div className="ds-dialog-inner">{inner}</div>
      )}
      <span className="ds-dialog-close">
        <Button size="sm" glyph="close" label="Close" onClick={modal.close} />
      </span>
    </dialog>
  );
}
