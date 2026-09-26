import { useSyncExternalStore } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";

type Toast = { id: number; tone: "ok" | "bad"; text: string };

let toasts: Toast[] = [];
let next = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function push(tone: Toast["tone"], text: string) {
  const id = next++;
  toasts = [...toasts, { id, tone, text }].slice(-4);
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 4000);
}

export const notify = { ok: (text: string) => push("ok", text), error: (text: string) => push("bad", text) };

export function Toaster() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
  );
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          {t.tone === "ok" ? <CircleCheck /> : <CircleAlert />}
          <p>{t.text}</p>
        </div>
      ))}
    </div>
  );
}
