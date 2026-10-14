import type { ReactNode } from "react";
import { useTranslations } from "@/contexts/i18n";
import type { Action, Call, Item, Sub, Turn } from "@/lib/transcript";
import { field, HZ } from "@/lib/transcript";
import { clock, duration, joined, tokens } from "@/lib/time";
import { Markdown } from "@/ui/bits";
import { useToolLabel } from "@/ui/marks";
import { Alert } from "@/ds/alert";
import { Gate } from "@/ds/gate";
import { Message } from "@/ds/message";
import { Signed, SignedActions, SignedError, SignedProse, SignedRun, SignedSubagents } from "@/ds/signed";
import { Status } from "@/ds/status";

export type Signer = { name: string; icon: "agent" | "subagent" };

// A tool's face, as vrcl's runs helper names them.
const FACES: Record<string, string> = {
  Bash: "bash", BashOutput: "bash", KillShell: "bash", Read: "read", Edit: "edit", MultiEdit: "edit", Write: "edit",
  NotebookEdit: "edit", Glob: "grep", Grep: "grep", LS: "grep", Task: "subagent", Agent: "subagent",
  SendMessage: "subagent", Skill: "skill", TodoWrite: "plan", EnterPlanMode: "plan", ExitPlanMode: "plan",
  set_title: "settitle", push_branch: "push", create_pull_request: "pr", navigate_preview: "preview",
};

export function face(tool: string) {
  return FACES[tool.startsWith(HZ) ? tool.slice(HZ.length) : tool] ?? "tool";
}

// The one detail worth a line: a command, a path, a title.
export function hint(input: string): string {
  return field(input, "command", "file_path", "notebook_path", "path", "pattern", "url", "query", "title", "description", "to").split("\n")[0];
}

export function Items({ items, signer, subHref }: { items: Item[]; signer: Signer; subHref: (id: string) => string }) {
  const { t } = useTranslations();
  return (
    <>
      {items.map((i) => {
        switch (i.kind) {
          case "you":
            return <You key={i.key} text={i.text} at={i.at} to={i.to} />;
          case "turn":
            return <Box key={i.key} turn={i.turn} signer={signer} subHref={subHref} />;
          case "notice":
            return (
              <Alert key={i.key} tone="info">
                {i.text}
              </Alert>
            );
          case "stopped":
            return (
              <Status key={i.key} state="idle">
                {t("session.stopped")}
              </Status>
            );
        }
      })}
    </>
  );
}

// Your message. queued: the control to withdraw it while it waits.
export function You({ text, at, to, action, queued }: { text: string; at?: string; to?: string; action?: ReactNode; queued?: boolean }) {
  const { t } = useTranslations();
  return (
    <Message name={t("session.you")} time={at ? clock(at) : undefined} queued={queued} agent={to} action={action}>
      <Markdown>{text}</Markdown>
    </Message>
  );
}

// One turn of the agent, signed: its calls folded under a counter, open while it runs, then what it said.
function Box({ turn, signer, subHref }: { turn: Turn; signer: Signer; subHref: (id: string) => string }) {
  const { t } = useTranslations();
  let lastCall = -1;
  turn.parts.forEach((p, i) => {
    if (p.kind === "call") lastCall = i;
  });
  const folded = turn.parts.slice(0, lastCall + 1);
  const answer = turn.parts.slice(lastCall + 1);
  const calls = folded.filter((p) => p.kind === "call").length;
  const meta = joined(clock(turn.at), duration(turn.duration), tokens(turn.tokens));
  return (
    <Signed name={signer.name} icon={signer.icon} meta={meta}>
      {folded.length > 0 && (
        <SignedActions count={calls} open={turn.live && answer.length === 0}>
          {folded.map((p, i) =>
            p.kind === "prose" ? (
              <SignedProse key={i}>
                <Markdown>{p.text}</Markdown>
              </SignedProse>
            ) : (
              <Run key={i} call={p.call} live={turn.live} />
            ),
          )}
        </SignedActions>
      )}
      {answer.map((p, i) =>
        p.kind === "prose" ? (
          <SignedProse key={i}>
            <Markdown>{p.text}</Markdown>
          </SignedProse>
        ) : null,
      )}
      {turn.subs.length > 0 && <Subs subs={turn.subs} subHref={subHref} />}
      {turn.actions.map((a) => (
        <ActionRow key={a.id} action={a} />
      ))}
      {turn.error && <SignedError title={t("session.failed")}>{turn.error}</SignedError>}
    </Signed>
  );
}

// A call without a result runs only while its turn does; in a turn that ended, its result will not come.
function Run({ call, live }: { call: Call; live: boolean }) {
  const label = useToolLabel();
  const detail = field(call.input, "command") || hint(call.input);
  return (
    <SignedRun
      tool={face(call.tool)}
      label={label(call.tool)}
      command={detail || call.input}
      state={call.result === undefined ? (live ? "running" : "done") : "done"}
      output={call.result}
    />
  );
}

function Subs({ subs, subHref }: { subs: Sub[]; subHref: (id: string) => string }) {
  const { t } = useTranslations();
  return (
    <SignedSubagents
      title={t("subs.label")}
      agents={subs.map((s) => ({
        name: s.name,
        line: s.waiting ? t("gate.needs_you") : s.last,
        state: s.state,
        time: s.duration ? duration(s.duration) : undefined,
        tools: s.tools,
        tokens: s.tokens,
        href: subHref(s.id),
      }))}
    />
  );
}

// An hz action: a denied one as its decided gate, the others as runs with their outcome.
function ActionRow({ action }: { action: Action }) {
  const { t } = useTranslations();
  const label = useToolLabel();
  const detail = field(action.input, "title", "path") || action.input;
  if (action.state === "denied" || action.state === "stopped")
    return <Gate tool={face(action.name)} label={label(action.name)} action={detail} state="denied" meta={t(`actions.${action.state}`)} />;
  const state = action.state === "failed" ? "failed" : action.state === "running" || action.state === "pending" ? "running" : "done";
  return <SignedRun tool={face(action.name)} label={label(action.name)} command={detail} state={state} output={action.outcome} />;
}
