import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, BotMessageSquare, ChevronRight, CircleCheck, UserRound as AvatarIcon } from "lucide-react";
import { useTranslations } from "@/contexts/i18n";
import type { Action, Call, Item, Part, Sub, Turn } from "@/lib/transcript";
import { field } from "@/lib/transcript";
import { clock, duration, joined, tokens } from "@/lib/time";
import { Markdown } from "@/ui/bits";
import { Dot, Face, toolIcon, useToolLabel, type Family } from "@/ui/marks";

export type Signer = { name: string; icon: LucideIcon; family: Family };

// The one detail worth a line: a command, a path, a title.
export function hint(input: string): string {
  return field(input, "command", "file_path", "notebook_path", "path", "pattern", "url", "query", "title", "description", "to").split("\n")[0];
}

export function Items({ items, signer, onSub }: { items: Item[]; signer: Signer; onSub: (id: string) => void }) {
  const { t } = useTranslations();
  return (
    <>
      {items.map((i) => {
        switch (i.kind) {
          case "you":
            return <You key={i.key} text={i.text} at={i.at} to={i.to} />;
          case "turn":
            return <Signed key={i.key} turn={i.turn} signer={signer} onSub={onSub} />;
          case "notice":
            return (
              <p key={i.key} className="notice">
                {i.text}
              </p>
            );
          case "stopped":
            return (
              <p key={i.key} className="outcome">
                <CircleCheck />
                {t("session.stopped")}
              </p>
            );
        }
      })}
    </>
  );
}

// queued: the control to withdraw a queued message; held: the session is at rest, so it waits for the next run.
export function You({ text, at, to, queued, held }: { text: string; at?: string; to?: string; queued?: React.ReactNode; held?: boolean }) {
  const { t } = useTranslations();
  return (
    <div className="msg">
      <Face icon={AvatarIcon} family="purple" />
      <div style={{ minWidth: 0 }}>
        <div className="who">
          <b>{t("session.you")}</b>
          {to && <span className="caption">{t("session.to", { name: to })}</span>}
          {at && <span className="meta">{clock(at)}</span>}
          {queued && <span className="meta">{t(held ? "queue.held" : "queue.queued")}</span>}
        </div>
        {queued ? (
          <div className="bubble queued">
            <span>{text}</span>
            {queued}
          </div>
        ) : (
          <div className="bubble">{text}</div>
        )}
      </div>
    </div>
  );
}


function Signed({ turn, signer, onSub }: { turn: Turn; signer: Signer; onSub: (id: string) => void }) {
  const { t } = useTranslations();
  let lastCall = -1;
  turn.parts.forEach((p, i) => {
    if (p.kind === "call") lastCall = i;
  });
  const folded = turn.parts.slice(0, lastCall + 1);
  const answer = turn.parts.slice(lastCall + 1);
  const calls = folded.filter((p) => p.kind === "call").length;
  const [toggled, setToggled] = useState<boolean>();
  const open = toggled ?? (turn.live && answer.length === 0);
  const Icon = signer.icon;
  return (
    <section className="signed" aria-label={signer.name}>
      <div className="signed-head">
        <span className={`stab fam-${signer.family}`}>
          <span className="fc">
            <Icon />
          </span>
          <span className="n">{signer.name}</span>
        </span>
        <span className="meta truncate">{joined(clock(turn.at), duration(turn.duration), tokens(turn.tokens))}</span>
      </div>
      <div className="signed-box">
        {folded.length > 0 && (
          <>
            <button type="button" className="fold" aria-expanded={open} onClick={() => setToggled(!open)}>
              <ChevronRight />
              {t("session.actions", { count: calls })}
              {turn.live && answer.length === 0 && <span className="spin" />}
            </button>
            {open && (
              <div className="fold-body">
                {folded.map((p, i) => (
                  <PartView key={i} part={p} live={turn.live} />
                ))}
              </div>
            )}
          </>
        )}
        {answer.map((p, i) => (
          <PartView key={i} part={p} live={turn.live} />
        ))}
        {turn.subs.length > 0 && <Subs subs={turn.subs} onSub={onSub} />}
        {turn.actions.map((a) => (
          <ActionRow key={a.id} action={a} />
        ))}
        {turn.error && (
          <div className="prose" role="alert" style={{ display: "flex", gap: 8, color: "var(--bad)" }}>
            <AlertTriangle width={14} height={14} style={{ marginTop: 3, flex: "none" }} />
            <pre style={{ whiteSpace: "pre-wrap", color: "var(--g12)", overflowWrap: "anywhere" }}>{turn.error}</pre>
          </div>
        )}
      </div>
    </section>
  );
}

function PartView({ part, live }: { part: Part; live: boolean }) {
  if (part.kind === "prose")
    return (
      <div className="prose">
        <Markdown>{part.text}</Markdown>
      </div>
    );
  return <CallRow call={part.call} live={live} />;
}

// A call without a result spins only while its turn runs; in a turn that ended, its result will not come.
function CallRow({ call, live }: { call: Call; live: boolean }) {
  const label = useToolLabel();
  const [open, setOpen] = useState(false);
  const Icon = toolIcon(call.tool);
  const detail = field(call.input, "command") || hint(call.input);
  return (
    <>
      <button type="button" className="run" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Face icon={Icon} family="olive" size={20} />
        <b>{label(call.tool)}</b>
        <span className="cmd">{detail}</span>
        {call.result === undefined && live ? <span className="spin" /> : <span />}
        <ChevronRight />
      </button>
      {open && (
        <pre className="run-out">
          <span className="in">{detail || call.input}</span>
          {call.result !== undefined && "\n\n" + (call.result || "—")}
        </pre>
      )}
    </>
  );
}

function Subs({ subs, onSub }: { subs: Sub[]; onSub: (id: string) => void }) {
  const { t } = useTranslations();
  const count = (s: Sub["state"]) => subs.filter((x) => x.state === s).length;
  const tally = [
    count("done") && t("subs.done", { count: count("done") }),
    count("running") && t("subs.running", { count: count("running") }),
    count("failed") && t("subs.failed", { count: count("failed") }),
  ];
  return (
    <>
      <div className="tally">{joined(t("subs.label"), ...tally.map((x) => x || undefined))}</div>
      {subs.map((s) => (
        <button key={s.id} type="button" className="sub" onClick={() => onSub(s.id)} aria-label={t("subs.open", { name: s.name })}>
          <span className="mk">
            {s.waiting ? <Dot tone="busy" /> : s.state === "running" ? <span className="spin" /> : s.state === "failed" ? <Dot tone="bad" /> : <CircleCheck color="var(--ok)" />}
          </span>
          <Face icon={BotMessageSquare} family="blue" size={20} />
          <span className="nm">{s.name}</span>
          <span className="ln">{s.waiting ? t("gate.needs_you") : s.last}</span>
          <span className="meta">{joined(duration(s.duration), s.tools !== undefined && t("subs.tools", { count: s.tools }), tokens(s.tokens).replace(" tokens", ""))}</span>
        </button>
      ))}
    </>
  );
}

function ActionRow({ action }: { action: Action }) {
  const { t } = useTranslations();
  const label = useToolLabel();
  const [open, setOpen] = useState(false);
  const Icon = toolIcon(action.name);
  const url = action.state === "done" ? action.outcome?.match(/https?:\/\/\S+/)?.[0] : undefined;
  const status = {
    pending: (
      <span className="status">
        <Dot tone="busy" />
        {t("gate.needs_you")}
      </span>
    ),
    running: (
      <span className="status">
        <span className="spin" />
        {t("actions.running")}
      </span>
    ),
    done: url ? (
      <a className="status" href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
        <Dot tone="ok" />
        {t("actions.open")}
      </a>
    ) : (
      <span className="status">
        <Dot tone="ok" />
        {t("actions.done")}
      </span>
    ),
    denied: (
      <span className="status">
        <Dot tone="idle" />
        {t("actions.denied")}
      </span>
    ),
    stopped: (
      <span className="status">
        <Dot tone="idle" />
        {t("actions.stopped")}
      </span>
    ),
    failed: (
      <span className="status">
        <Dot tone="bad" />
        {t("actions.failed")}
      </span>
    ),
  }[action.state];
  return (
    <>
      <button type="button" className="run" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Face icon={Icon} family="olive" size={20} />
        <b>{label(action.name)}</b>
        <span className="cmd">{field(action.input, "title", "path")}</span>
        {status}
        <ChevronRight />
      </button>
      {open && <pre className="run-out">{action.outcome ?? action.input}</pre>}
    </>
  );
}
