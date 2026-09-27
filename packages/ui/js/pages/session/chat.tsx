import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslations } from "@/contexts/i18n";
import { messageFrom } from "@/contexts/api/errors";
import { useApprovals, useQueue, useSay, useStop, useUnqueue } from "@/contexts/api/sessions";
import { useLink } from "@/contexts/api/stream";
import type { Approval, Environment, Session, State } from "@/contexts/api/types";
import { allSubs, HZ, outcomeFor, subTranscript, transcript } from "@/lib/transcript";
import { Markdown } from "@/ui/bits";
import { Alert } from "@/ds/alert";
import { Badge } from "@/ds/badge";
import { Button } from "@/ds/button";
import { Composer } from "@/ds/composer";
import { Dialog } from "@/ds/dialog";
import { Dock } from "@/ds/dock";
import { Page } from "@/ds/page";
import { Signed, SignedProse } from "@/ds/signed";
import { Stack } from "@/ds/stack";
import { Tabs } from "@/ds/tabs";
import { toast } from "@/ds/toast";
import { Working } from "@/ds/working";
import { Gates } from "@/pages/session/gate";
import { Items, You, type Signer } from "@/pages/session/turn";

const COMPOSER: Record<State, "ready" | "working" | "blocked"> = {
  forking: "working",
  running: "working",
  awaiting_approval: "blocked",
  idle: "ready",
  failed: "ready",
};

// The chat view, as vrcl's session page: the head, the conversations as tabs when there are sub-agents, the thread,
// and the dock of approvals over the composer.
export function Chat({ session, env, head }: { session: Session; env?: Environment; head: ReactNode }) {
  const { t } = useTranslations();
  const [params] = useSearchParams();
  const busy = session.state === "running" || session.state === "forking";
  const approvals = useApprovals();
  const mine = useMemo(() => (approvals.data ?? []).filter((a) => a.session === session.id), [approvals.data, session.id]);
  // Every approval decided and none left: the plane is carrying the actions out, and the outcome turn follows.
  const acting = session.state === "awaiting_approval" && approvals.isSuccess && mine.length === 0;
  const live = busy || acting;
  const items = useMemo(() => transcript(session.events, live, mine), [session.events, live, mine]);
  const subs = useMemo(() => allSubs(items), [items]);
  const sub = subs.find((s) => s.id === params.get("agent"));
  const shown = sub ? subTranscript(sub, live, mine, outcomeFor(session.events, sub)) : items;
  const agent: Signer = { name: t("session.agent"), icon: "agent" };
  const signer: Signer = sub ? { name: sub.name, icon: "subagent" } : agent;
  const queue = useQueue(session.id);
  const say = useSay(session.id);
  const href = (id?: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set("agent", id);
    else next.delete("agent");
    const q = next.toString();
    return `/s/${session.id}${q ? `?${q}` : ""}`;
  };
  const askedBy = (a: Approval) =>
    subs.find((s) => s.events.some((e) => e.kind === "tool_use" && e.tool === HZ + a.tool && e.content === a.input))?.name ?? agent.name;
  const lastPrompt = [...session.events].reverse().find((e) => e.kind === "prompt")?.at ?? session.at;
  const held = session.state === "idle" || session.state === "failed";

  const tabs =
    subs.length > 0 ? (
      <Tabs
        label={t("session.transcript")}
        items={[
          { label: agent.name, href: href(), icon: "agent", current: !sub },
          ...subs.map((s) => ({
            label: s.name,
            href: href(s.id),
            icon: "subagent" as const,
            mono: true,
            state: s.waiting || s.state === "running" ? ("busy" as const) : s.state === "failed" ? ("bad" as const) : ("ok" as const),
            current: sub?.id === s.id,
          })),
        ]}
      />
    ) : undefined;

  const foot = (
    <Dock follow>
      <Gates approvals={mine} session={session} env={env} askedBy={askedBy} />
      <Composer
        key={sub?.id ?? "session"}
        agent={signer.name}
        state={COMPOSER[session.state]}
        attach={false}
        placeholder={sub ? t("composer.reply", { name: sub.name }) : busy ? t("composer.queue_placeholder") : t("composer.write")}
        picker={
          <Badge family="blue" icon={signer.icon}>
            {signer.name}
          </Badge>
        }
        onSubmit={async ({ text }) => {
          try {
            await say.mutateAsync({ prompt: text, to: sub?.id });
          } catch (e) {
            toast({ kind: "error", message: messageFrom(e, t) });
            throw e;
          }
        }}
      />
    </Dock>
  );

  return (
    <Page layout="column" width="narrow" head={head} tabs={tabs} foot={foot}>
      <Stack gap={24} role="log" aria-label={t("session.transcript")}>
        <Stack gap={32}>
          {sub && (
            <Signed name={`${agent.name} → ${sub.name}`} icon="agent">
              <SignedProse>
                <Markdown>{sub.prompt}</Markdown>
              </SignedProse>
            </Signed>
          )}
          {!sub && session.events.length === 0 && session.pending && <You text={session.pending} at={session.at} />}
          <Items items={shown} signer={signer} subHref={href} />
          {!sub &&
            (queue.data ?? []).map((text, index) => <Queued key={`${index}:${text}`} session={session.id} index={index} text={text} held={held} />)}
        </Stack>
        <Reconnecting />
        {(!sub || sub.state === "running") && <Doing session={session} since={lastPrompt} acting={acting} />}
      </Stack>
    </Page>
  );
}

function Reconnecting() {
  const { t } = useTranslations();
  const link = useLink();
  return <Working kind="reconnecting" connected={link !== "reconnecting"} text={t("link.reconnecting")} />;
}

// The working line: the sandbox being set up, the agent working, or waiting on you; Stop while the agent runs.
function Doing({ session, since, acting }: { session: Session; since?: string; acting: boolean }) {
  const { t } = useTranslations();
  const stop = useStop(session.id);
  const [asking, setAsking] = useState(false);
  if (session.state === "failed")
    return (
      <Alert tone="error" title={t("session.failed")}>
        {session.error && <pre>{session.error}</pre>}
        <p>{t("session.failed_next")}</p>
      </Alert>
    );
  if (session.state === "idle") return null;
  const kind = acting ? "working" : session.state === "forking" ? "preparing" : session.state === "awaiting_approval" ? "waiting" : "working";
  const text = t(acting ? "session.working" : { forking: "session.forking", running: "session.working", awaiting_approval: "session.waiting" }[session.state]);
  return (
    <>
      <Working kind={kind} text={text} since={since ? new Date(since) : undefined} onStop={session.state === "running" ? () => setAsking(true) : undefined} />
      <Dialog
        id="stop"
        alert
        open={asking}
        title={t("session.stop_title")}
        text={t("session.stop_body")}
        onClose={() => setAsking(false)}
        foot={
          <>
            <Button onClick={() => setAsking(false)}>{t("session.keep")}</Button>
            <Button
              variant="danger"
              loading={stop.isPending}
              onClick={() =>
                stop.mutate(undefined, {
                  onSuccess: () => setAsking(false),
                  onError: (e) => toast({ kind: "error", message: messageFrom(e, t) }),
                })
              }
            >
              {t("session.stop")}
            </Button>
          </>
        }
      />
    </>
  );
}

// After a stop or a failure the queue stays as it was: shown, and each message can still be withdrawn.
function Queued({ session, index, text, held }: { session: string; index: number; text: string; held: boolean }) {
  const { t } = useTranslations();
  const unqueue = useUnqueue(session);
  return (
    <You
      text={text}
      queued
      to={held ? t("queue.held") : undefined}
      action={
        <Button
          variant="ghost"
          size="sm"
          loading={unqueue.isPending}
          onClick={() => unqueue.mutate({ index, text }, { onError: (e) => toast({ kind: "error", message: messageFrom(e, t) }) })}
        >
          {t("queue.withdraw")}
        </Button>
      }
    />
  );
}
