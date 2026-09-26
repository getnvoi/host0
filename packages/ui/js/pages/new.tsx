import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Box, ChevronDown } from "lucide-react";
import { useTranslations } from "@/contexts/i18n";
import { messageFrom } from "@/contexts/api/errors";
import { useEnvironments, useStart } from "@/contexts/api/sessions";
import { Composer } from "@/ui/composer";
import { Dialog } from "@/ui/dialog";
import { notify } from "@/ui/toast";

// New session: one step, a composer whose foot picks the environment. Open wherever ?new=1 is set, or with N.
export function NewSession() {
  const [params, setParams] = useSearchParams();
  const open = params.get("new") === "1";
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input, textarea, select, [contenteditable], .xterm");
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && !e.altKey && !typing && !document.querySelector("dialog[open]")) {
        e.preventDefault();
        const next = new URLSearchParams(params);
        next.set("new", "1");
        setParams(next);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [params, setParams]);
  if (!open) return null;
  return (
    <Starter
      onClose={() => {
        const next = new URLSearchParams(params);
        next.delete("new");
        setParams(next);
      }}
    />
  );
}

function Starter({ onClose }: { onClose: () => void }) {
  const { t } = useTranslations();
  const navigate = useNavigate();
  const envs = useEnvironments();
  const start = useStart();
  const ready = (envs.data ?? []).filter((e) => e.ready);
  const [env, setEnv] = useState<string>();
  const chosen = env ?? ready[0]?.name;
  const text = envs.isSuccess && ready.length === 0 ? t("new.no_environment") : t("new.text");

  return (
    <Dialog title={t("session.new")} text={text} width={840} onClose={onClose}>
      <Composer
        draft="new"
        autoFocus
        tall
        state={chosen ? "ready" : "broken"}
        placeholder={t("new.placeholder")}
        start={
          ready.length > 0 && (
            <label className="picker">
              <Box />
              <select aria-label={t("new.environment")} value={chosen} onChange={(e) => setEnv(e.target.value)}>
                {ready.map((e) => (
                  <option key={e.name} value={e.name}>
                    {e.name} · {e.tier || "medium"}
                  </option>
                ))}
              </select>
              <ChevronDown />
            </label>
          )
        }
        onSend={async (prompt) => {
          if (!chosen) return false;
          try {
            const s = await start.mutateAsync({ env: chosen, prompt });
            navigate(`/s/${s.id}`);
          } catch (e) {
            notify.error(messageFrom(e, t));
            return false;
          }
        }}
      />
    </Dialog>
  );
}
