import { useEffect, useState } from "react";
import { useTranslations } from "@/contexts/i18n";
import { messageFrom } from "@/contexts/api/errors";
import { useDecide } from "@/contexts/api/sessions";
import type { Approval, Environment, Session } from "@/contexts/api/types";
import { field } from "@/lib/transcript";
import { useToolLabel } from "@/ui/marks";
import { toast } from "@/ds/toast";
import { Gate as Ask, GateStack } from "@/ds/gate";
import { face } from "@/pages/session/turn";

// A decision the plane took but the approvals list still shows as pending frees the buttons after this long.
const SETTLE = 30_000;

// Every call waiting on you, oldest first, right above the composer.
export function Gates({ approvals, session, env, askedBy }: { approvals: Approval[]; session: Session; env?: Environment; askedBy: (a: Approval) => string }) {
  if (approvals.length === 0) return null;
  return (
    <GateStack>
      {approvals.map((a) => (
        <Gate key={a.id} approval={a} session={session} env={env} askedBy={askedBy(a)} />
      ))}
    </GateStack>
  );
}

function Gate({ approval, session, env, askedBy }: { approval: Approval; session: Session; env?: Environment; askedBy: string }) {
  const { t } = useTranslations();
  const label = useToolLabel();
  const decide = useDecide();
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
          toast({ kind: "error", message: messageFrom(e, t) });
        },
      },
    );
  };
  // As vrcl's gates helper: the exact command, then what it leaves out.
  const push = approval.tool === "push_branch" || approval.tool === "create_pull_request";
  const details: Record<string, string> = {};
  if (env) details[t("gate.repository")] = env.repo;
  if (push) details[t("gate.branch")] = session.branch;
  if (approval.tool === "create_pull_request") {
    const title = field(approval.input, "title");
    const body = field(approval.input, "body");
    if (title) details[t("gate.title")] = title;
    if (env) details[t("gate.into")] = env.branch;
    if (body) details[t("gate.body")] = body;
  }
  return (
    <Ask
      tool={face(approval.tool)}
      label={label(approval.tool)}
      action={push ? `git push origin ${session.branch}` : approval.input}
      details={details}
      agent={askedBy}
      sending={sent || decide.isPending}
      onDecide={(d) => act(d === "approve")}
    />
  );
}
