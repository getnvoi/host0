import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { useTranslations } from "@/contexts/i18n";
import { messageFrom } from "@/contexts/api/errors";
import { useDecide } from "@/contexts/api/sessions";
import type { Approval, Environment, Session } from "@/contexts/api/types";
import { field } from "@/lib/transcript";
import { notify } from "@/ui/toast";
import { Dot, Face, toolIcon, useToolLabel } from "@/ui/marks";

// A decision the plane took but the approvals list still shows as pending frees the buttons after this long.
const SETTLE = 30_000;

// What the agent waits on: the exact action, what it touches, Deny then Allow.
export function Gates({ approvals, session, env, askedBy }: { approvals: Approval[]; session: Session; env?: Environment; askedBy: (a: Approval) => string }) {
  if (approvals.length === 0) return null;
  return (
    <div className="gates">
      {approvals.map((a) => (
        <Gate key={a.id} approval={a} session={session} env={env} askedBy={askedBy(a)} />
      ))}
    </div>
  );
}

function Gate({ approval, session, env, askedBy }: { approval: Approval; session: Session; env?: Environment; askedBy: string }) {
  const { t } = useTranslations();
  const label = useToolLabel();
  const decide = useDecide();
  const Icon = toolIcon(approval.tool);
  // Once decided, the buttons stay off until fresh approvals no longer list this one, which unmounts the gate.
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (!sent) return;
    const timer = setTimeout(() => setSent(false), SETTLE);
    return () => clearTimeout(timer);
  }, [sent]);
  const act = (approve: boolean) => {
    setSent(true);
    decide.mutate(
      { id: approval.id, approve },
      {
        onError: (e) => {
          setSent(false);
          notify.error(messageFrom(e, t));
        },
      },
    );
  };
  const busy = sent || decide.isPending;
  const push = `git push origin HEAD:refs/heads/${session.branch}`;
  const title = field(approval.input, "title");
  const body = field(approval.input, "body");
  const details: [string, string][] = [];
  if (env) details.push([t("gate.repository"), env.repo]);
  if (approval.tool === "create_pull_request") {
    if (title) details.push([t("gate.title"), title]);
    if (env) details.push([t("gate.into"), env.branch]);
    if (body) details.push([t("gate.body"), body]);
  }
  const action = approval.tool === "push_branch" || approval.tool === "create_pull_request" ? push : approval.input;
  return (
    <section className="gate" aria-label={t("gate.label")}>
      <div className="gate-head">
        <Face icon={Icon} family="olive" />
        <b>{label(approval.tool)}</b>
        <span className="status">
          <Dot tone="busy" />
          {t("gate.needs_you")}
        </span>
      </div>
      <pre>{action}</pre>
      {details.length > 0 && (
        <dl>
          {details.map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="gate-foot">
        <span className="meta">{t("gate.asked", { name: askedBy })}</span>
        <button type="button" className="btn outline" disabled={busy} onClick={() => act(false)}>
          <X />
          {t("gate.deny")}
        </button>
        <button type="button" className="btn solid" disabled={busy} onClick={() => act(true)}>
          <Check />
          {t("gate.allow")}
        </button>
      </div>
    </section>
  );
}
