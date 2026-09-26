import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowLeft, Bot, BotMessageSquare, CircleAlert, Square, X } from "lucide-react";
import { useTranslations } from "@/contexts/i18n";
import { messageFrom } from "@/contexts/api/errors";
import { useApprovals, useQueue, useSay, useStop, useUnqueue } from "@/contexts/api/sessions";
import type { Approval, Environment, Session, State } from "@/contexts/api/types";
import { allSubs, NVOI, outcomeFor, subTranscript, transcript, type Sub } from "@/lib/transcript";
import { duration } from "@/lib/time";
import { useStickToBottom } from "@/lib/use-stick-to-bottom";
import { Alert, useElapsed } from "@/ui/bits";
import { Composer, type ComposerState } from "@/ui/composer";
import { Confirm } from "@/ui/dialog";
import { Dot, Face } from "@/ui/marks";
import { Menu } from "@/ui/menu";
import { notify } from "@/ui/toast";
import { Gates } from "@/pages/session/gate";
import { Items, You, type Signer } from "@/pages/session/turn";

const COMPOSER: Record<State, ComposerState> = {
  forking: "working",
  running: "working",
  awaiting_approval: "blocked",
  idle: "ready",
  failed: "ready",
};

export function Chat({ session, env }: { session: Session; env?: Environment }) {
  const { t } = useTranslations();
  const [params, setParams] = useSearchParams();
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
  const agent: Signer = { name: t("session.agent"), icon: Bot, family: "blue" };
  const signer: Signer = sub ? { name: sub.name, icon: BotMessageSquare, family: "blue" } : agent;
  const queue = useQueue(session.id);
  const say = useSay(session.id);
  const { ref, atBottom, onScroll, toBottom } = useStickToBottom(`${session.events.length}:${queue.data?.length}:${sub?.id}`);
  const foot = useRef<HTMLDivElement>(null);
  const [footHeight, setFootHeight] = useState(0);
  useEffect(() => {
    const el = foot.current;
    if (!el) return;
    const fit = () => setFootHeight(el.offsetHeight);
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (atBottom) toBottom(false);
  }, [footHeight]);
  const pick = (id?: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set("agent", id);
    else next.delete("agent");
    setParams(next);
  };
  const askedBy = (a: Approval) =>
    subs.find((s) => s.events.some((e) => e.kind === "tool_use" && e.tool === NVOI + a.tool && e.content === a.input))?.name ?? agent.name;
  const lastPrompt = [...session.events].reverse().find((e) => e.kind === "prompt")?.at ?? session.at;

  return (
    <>
      <div className="page-scroll" ref={ref} onScroll={onScroll} style={{ paddingBottom: footHeight }}>
        <div className="transcript" role="log" aria-label={t("session.transcript")}>
          {sub ? (
            <>
              <button type="button" className="relay-head btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => pick()}>
                <ArrowLeft />
                {t("subs.back", { name: agent.name })}
              </button>
              <div className="msg">
                <Face icon={Bot} family="blue" />
                <div style={{ minWidth: 0 }}>
                  <div className="who">
                    <b>{agent.name}</b>
                    <span className="caption">{t("session.to", { name: sub.name })}</span>
                  </div>
                  <div className="bubble relay">{sub.prompt}</div>
                </div>
              </div>
            </>
          ) : (
            session.events.length === 0 && session.pending && <You text={session.pending} at={session.at} />
          )}
          <Items items={shown} signer={signer} onSub={pick} />
          {!sub &&
            (queue.data ?? []).map((text, index) => <Queued key={`${index}:${text}`} session={session.id} index={index} text={text} held={session.state === "idle" || session.state === "failed"} />)}
          {(!sub || sub.state === "running") && <Working session={session} since={lastPrompt} acting={acting} />}
        </div>
      </div>
      {!atBottom && (
        <button type="button" className="btn outline icon round jump" style={{ bottom: footHeight + 8 }} aria-label={t("session.latest")} onClick={() => toBottom()}>
          <ArrowDown />
        </button>
      )}
      <div className="foot" ref={foot}>
        <Gates approvals={mine} session={session} env={env} askedBy={askedBy} />
        <Composer
          key={sub?.id ?? "session"}
          draft={sub ? `${session.id}:${sub.id}` : session.id}
          autoFocus
          state={COMPOSER[session.state]}
          placeholder={sub ? t("composer.reply", { name: sub.name }) : busy ? t("composer.queue_placeholder") : t("composer.write")}
          start={<Switcher subs={subs} current={sub} agent={agent} onPick={pick} />}
          onSend={async (prompt) => {
            try {
              await say.mutateAsync({ prompt, to: sub?.id });
              toBottom();
            } catch (e) {
              notify.error(messageFrom(e, t));
              return false;
            }
          }}
        />
      </div>
    </>
  );
}

function Working({ session, since, acting }: { session: Session; since?: string; acting: boolean }) {
  const { t } = useTranslations();
  const stop = useStop(session.id);
  const [asking, setAsking] = useState(false);
  const elapsed = useElapsed(session.state === "running" || session.state === "forking" || session.state === "awaiting_approval" ? since : undefined);
  if (session.state === "failed")
    return (
      <Alert icon={CircleAlert} title={t("session.failed")}>
        {session.error && <pre>{session.error}</pre>}
        <p>{t("session.failed_next")}</p>
      </Alert>
    );
  if (session.state === "idle") return null;
  const line = acting ? "session.working" : { forking: "session.forking", running: "session.working", awaiting_approval: "session.waiting" }[session.state];
  return (
    <div className="working" aria-live="polite">
      <Dot tone="busy" breath={acting || session.state !== "awaiting_approval"} />
      <span>{t(line)}</span>
      <span className="meta">{duration(elapsed)}</span>
      {session.state === "running" && (
        <button type="button" className="btn ghost sm" onClick={() => setAsking(true)}>
          <Square />
          {t("session.stop")}
        </button>
      )}
      {asking && (
        <Confirm
          title={t("session.stop_title")}
          text={t("session.stop_body")}
          verb={
            <>
              <Square />
              {t("session.stop")}
            </>
          }
          cancel={t("session.keep")}
          busy={stop.isPending}
          onClose={() => setAsking(false)}
          onConfirm={() =>
            stop.mutate(undefined, {
              onSuccess: () => setAsking(false),
              onError: (e) => notify.error(messageFrom(e, t)),
            })
          }
        />
      )}
    </div>
  );
}

// After a stop or a failure the queue stays as it was: shown, and each message can still be withdrawn.
function Queued({ session, index, text, held }: { session: string; index: number; text: string; held: boolean }) {
  const { t } = useTranslations();
  const unqueue = useUnqueue(session);
  return (
    <You
      text={text}
      held={held}
      queued={
        <button
          type="button"
          className="btn ghost sm icon"
          aria-label={t("queue.withdraw")}
          title={t("queue.withdraw")}
          disabled={unqueue.isPending}
          onClick={() => unqueue.mutate({ index, text }, { onError: (e) => notify.error(messageFrom(e, t)) })}
        >
          <X />
        </button>
      }
    />
  );
}

// Who the next message goes to: the session's agent, or one of its sub-agents through it.
function Switcher({ subs, current, agent, onPick }: { subs: Sub[]; current?: Sub; agent: Signer; onPick: (id?: string) => void }) {
  const { t } = useTranslations();
  const badge = (
    <span className="badge fam-blue">
      {current ? <BotMessageSquare /> : <Bot />}
      <span className={current ? "mono truncate" : "truncate"} style={{ fontWeight: 500 }}>
        {current ? current.name : agent.name}
      </span>
    </span>
  );
  if (subs.length === 0) return badge;
  const ordered = [...subs].sort((a, b) => Number(b.state === "running") - Number(a.state === "running"));
  const others = ordered.filter((s) => s.id !== current?.id).slice(0, 2);
  return (
    <Menu
      label={t("subs.talk_to")}
      side="top"
      trigger={({ toggle, ...aria }) => (
        <button type="button" className="switcher" onClick={toggle} aria-label={t("subs.talk_to")} {...aria}>
          {badge}
          {others.map((s) => (
            <Face key={s.id} icon={BotMessageSquare} family="blue" />
          ))}
          {subs.length - others.length - (current ? 1 : 0) > 0 && <span className="more">+{subs.length - others.length - (current ? 1 : 0)}</span>}
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="menu-label">{t("subs.talk_to")}</div>
          <button type="button" role="menuitemradio" aria-checked={!current} className="menu-item" onClick={() => (close(), onPick())}>
            <Bot />
            <span>
              {agent.name}
              <small>{t("subs.the_session")}</small>
            </span>
            <span />
          </button>
          {ordered.map((s) => (
            <button key={s.id} type="button" role="menuitemradio" aria-checked={current?.id === s.id} className="menu-item" onClick={() => (close(), onPick(s.id))}>
              <BotMessageSquare />
              <span className="truncate">
                <span className="mono" style={{ fontWeight: 500 }}>
                  {s.name}
                </span>
                <small className="truncate">{s.waiting ? t("gate.needs_you") : s.last}</small>
              </span>
              <Dot tone={s.waiting || s.state === "running" ? "busy" : s.state === "failed" ? "bad" : "ok"} />
            </button>
          ))}
        </>
      )}
    </Menu>
  );
}
