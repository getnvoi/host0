import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type RefObject } from "react";
import { cx } from "./cx";

// Ds::Unsaved: the "Unsaved changes" mark, next to Save, for a form watched by useUnsaved: shown once a field differs
// from what was loaded, gone when saved.
export type UnsavedProps = {
  text?: string;
  // Shown from the start, for a form rendered back with changes the server has not saved.
  shown?: boolean;
} & HTMLAttributes<HTMLSpanElement>;

export function Unsaved({ text = "Unsaved changes", shown = false, className, ...rest }: UnsavedProps) {
  return (
    <span className={cx("ds-unsaved", className)} hidden={!shown} {...rest}>
      {text}
    </span>
  );
}

// On a form: remembers what it held when loaded, says it is dirty once a field differs, and asks before the page is
// unloaded with changes. Submitting is not leaving; `sent(true)` after a successful submit makes what was sent the new
// saved state.
export function useUnsaved(form: RefObject<HTMLFormElement | null>) {
  const saved = useRef("");
  const submitting = useRef(false);
  const [dirty, setDirty] = useState(false);

  const snapshot = useCallback(() => {
    if (!form.current) return "";
    const data = new FormData(form.current);
    data.delete("authenticity_token");
    return new URLSearchParams([...data].map(([key, value]) => [key, value instanceof File ? value.name : value])).toString();
  }, [form]);
  const isDirty = useCallback(() => !submitting.current && snapshot() !== saved.current, [snapshot]);

  useEffect(() => {
    const element = form.current;
    if (!element) return;
    saved.current = snapshot();
    const input = () => setDirty(isDirty());
    const sending = () => {
      submitting.current = true;
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (!isDirty()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    element.addEventListener("input", input);
    element.addEventListener("change", input);
    element.addEventListener("submit", sending);
    window.addEventListener("beforeunload", unload);
    return () => {
      element.removeEventListener("input", input);
      element.removeEventListener("change", input);
      element.removeEventListener("submit", sending);
      window.removeEventListener("beforeunload", unload);
    };
  }, [form, snapshot, isDirty]);

  // After the submit has an answer: on success what was sent is the saved state.
  const sent = useCallback(
    (success: boolean) => {
      submitting.current = false;
      if (success) saved.current = snapshot();
      setDirty(isDirty());
    },
    [snapshot, isDirty],
  );

  return { dirty, sent };
}
