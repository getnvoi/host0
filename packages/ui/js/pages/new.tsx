import { useEffect } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslations } from "@/contexts/i18n";
import { messageFrom } from "@/contexts/api/errors";
import { useEnvironments, useSessions, useStart } from "@/contexts/api/sessions";
import type { Environment } from "@/contexts/api/types";
import { Alert } from "@/ds/alert";
import { Badge } from "@/ds/badge";
import { Composer } from "@/ds/composer";
import { Dialog } from "@/ds/dialog";
import { Icon } from "@/ds/icon";
import { Row } from "@/ds/row";
import { Steps } from "@/ds/steps";
import { Text } from "@/ds/text";
import { toast } from "@/ds/toast";

// New session, as vrcl's: a bleed dialog of fixed height with the steps in a band under the title (where it runs,
// then the task). Open wherever ?new=1 is set, or with N.
export function NewSession() {
  const [params, setParams] = useSearchParams();
  const open = params.get("new") === "1";
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input, textarea, select, [contenteditable], .xterm");
      if (e.key === "n" && !e.defaultPrevented && !e.metaKey && !e.ctrlKey && !e.altKey && !typing && !document.querySelector("dialog[open]")) {
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
        next.delete("step");
        next.delete("env");
        setParams(next);
      }}
    />
  );
}

const short = (repo: string) => repo.replace(/^.*\//, "");

function Starter({ onClose }: { onClose: () => void }) {
  const { t } = useTranslations();
  const navigate = useNavigate();
  const envs = useEnvironments();
  const sessions = useSessions();
  const start = useStart();
  const ready = (envs.data ?? []).filter((e) => e.ready);
  // Without a choice it opens on the task, in the environment of the latest session.
  const latest = sessions.data?.find((s) => ready.some((e) => e.name === s.env))?.env;
  // Every step is a URL, as vrcl's: ?new=1&step=env lists the environments, &env=<name> picks one.
  const [params] = useSearchParams();
  const location = useLocation();
  const step = params.get("step") === "env" ? "env" : "task";
  const env: Environment | undefined = ready.find((e) => e.name === (params.get("env") ?? latest)) ?? ready[0];
  const to = (change: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(change)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    return `${location.pathname}?${next}`;
  };
  const none = envs.isSuccess && ready.length === 0;
  const onEnv = step === "env" || none;

  return (
    <Dialog
      id="new-session"
      open
      size="lg"
      bleed
      fixed
      title={t("session.new")}
      onClose={onClose}
      band={
        <Steps
          items={[
            onEnv
              ? { label: t("new.environment"), state: "current" }
              : { label: t("new.environment"), value: env?.name, state: "done", href: to({ step: "env" }) },
            { label: t("new.task"), state: onEnv ? "todo" : "current" },
          ]}
        />
      }
      foot={
        !onEnv &&
        env && (
          <>
            <span />
            <Text as="meta">{t("new.where", { repo: short(env.repo), branch: env.branch, env: env.name })}</Text>
          </>
        )
      }
    >
      {none ? (
        <Alert tone="warning">{t("new.no_environment")}</Alert>
      ) : onEnv ? (
        <div>
          {ready.map((e) => (
            <Row
              key={e.name}
              name={e.name}
              title={short(e.repo)}
              meta={[e.branch, e.tier || "medium"]}
              lead={<Icon name="env" size={20} />}
              href={to({ step: null, env: e.name })}
              current={e.name === env?.name}
            />
          ))}
        </div>
      ) : (
        <Composer
          flat
          attach={false}
          placeholder={t("new.placeholder")}
          disabled={!env}
          picker={
            <Badge family="blue" icon="agent">
              {t("session.agent")}
            </Badge>
          }
          onSubmit={async ({ text }) => {
            if (!env) return;
            try {
              const s = await start.mutateAsync({ env: env.name, prompt: text });
              navigate(`/s/${s.id}`);
            } catch (e) {
              toast({ kind: "error", message: messageFrom(e, t) });
              throw e;
            }
          }}
        />
      )}
    </Dialog>
  );
}
