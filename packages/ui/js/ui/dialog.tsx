import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslations } from "@/contexts/i18n";

// Native modal <dialog>: Escape, the close button and a click on the backdrop close it; focus returns to
// what opened it.
function useModal(onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const opener = document.activeElement as HTMLElement | null;
    if (!el.open) el.showModal();
    // showModal focuses the first control; the one meant to take focus is marked.
    el.querySelector<HTMLElement>("[data-autofocus], textarea")?.focus();
    return () => {
      if (el.open) el.close();
      opener?.focus?.();
    };
  }, []);
  return {
    ref,
    onCancel: (e: React.SyntheticEvent) => {
      e.preventDefault();
      onClose();
    },
    onMouseDown: (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
  };
}

export function Dialog({
  title,
  text,
  width = 440,
  onClose,
  foot,
  alert,
  children,
}: {
  title: string;
  text?: string;
  width?: number;
  onClose: () => void;
  foot?: ReactNode;
  alert?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslations();
  const modal = useModal(onClose);
  return (
    <dialog className="dialog" style={{ "--w": `${width}px` } as React.CSSProperties} role={alert ? "alertdialog" : undefined} aria-labelledby="dialog-title" {...modal}>
      <div className="dialog-body">
        <h2 id="dialog-title" className="dialog-title">
          {title}
        </h2>
        {text && <p className="dialog-text">{text}</p>}
        {children && <div className="dialog-content">{children}</div>}
        {!alert && (
          <button type="button" className="btn ghost sm icon dialog-close" aria-label={t("common.close")} onClick={onClose}>
            <X />
          </button>
        )}
      </div>
      {foot && <div className="dialog-foot">{foot}</div>}
    </dialog>
  );
}

export function Confirm({
  title,
  text,
  verb,
  cancel,
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  text: string;
  verb: ReactNode;
  cancel: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      title={title}
      text={text}
      alert
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn ghost" onClick={onClose} data-autofocus>
            {cancel}
          </button>
          <button type="button" className="btn danger" disabled={busy} onClick={onConfirm}>
            {verb}
          </button>
        </>
      }
    />
  );
}

export function Sheet({
  side = "right",
  width,
  label,
  onClose,
  head,
  children,
}: {
  side?: "left" | "right";
  width?: number;
  label: string;
  onClose: () => void;
  head?: ReactNode;
  children: ReactNode;
}) {
  const modal = useModal(onClose);
  return (
    <dialog className={`sheet ${side}`} style={width ? ({ "--w": `${width}px` } as React.CSSProperties) : undefined} aria-label={label} {...modal}>
      {head}
      {children}
    </dialog>
  );
}
