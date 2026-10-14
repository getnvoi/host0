import { useContext, useState } from "react";
import { TabStrip } from "../../chrome";
import { Approval, GateAnswer, Notice, Question, TerminalBlock, Toast, ToastLayer } from "../../conversation";
import { DayList, type DayRow } from "../../data";
import { Dialog } from "../../heads";
import { SelectInput } from "../../inputs";
import { listEmpty, ListPage } from "../../lists";
import { menu } from "../../menu";
import { Button } from "../../primitives";
import { fieldSize, type Tone } from "../../tokens";
import { ShowsTabStrip, useNavigate } from "../navigate";
import { paths } from "../routes";
import { load, project, words, type AuthorRecord, type EventRecord, type Load } from "./records";
import { sessionState } from "./state";
import { Tools } from "./transcript";

// The session a request waits in, as an Inbox row places it. `repo` is the full name, `owner/repo`; `branch` is
// what a push names.
export type InboxPlace = {
  sessionId: string;
  title: string;
  repo: string;
  owner: string;
  environment?: string | null;
  branch: string;
  // The session's agent, by name; questions read "<agent> asks".
  agent?: string;
};

// What waits on a member: a call parked at a gate (an `Event` of kind `tool_use`), or a note that mentions them
// (handled once they reply or send it).
// Or a production environment that is degraded or down, until its health returns to ok (`resolved`).
export type InboxItem =
  | { kind: "call"; event: EventRecord; place: InboxPlace }
  | { kind: "mention"; id: string; author: AuthorRecord; text: string; handled: boolean; createdAt: string; place: InboxPlace }
  | { kind: "health"; id: string; environmentId: string; environment: string; repo: string; owner: string; status: "degraded" | "down"; reasons: string[]; resolved: boolean; createdAt: string };

// An item that waits in a session.
export type PlacedItem = Exclude<InboxItem, { kind: "health" }>;

export const inboxItem = {
  id: (i: InboxItem) => (i.kind === "call" ? i.event.id : i.id),
  createdAt: (i: InboxItem) => (i.kind === "call" ? i.event.createdAt : i.createdAt),
  // Still waiting: a call not decided, a mention not handled, an environment not back to ok.
  waiting: (i: InboxItem) => (i.kind === "call" ? i.event.approvalStatus === "pending" : i.kind === "health" ? !i.resolved : !i.handled),
  // What the row says: a call's question or tool, a mention's author and the start of the note.
  title: (i: InboxItem) =>
    i.kind === "call" ? Tools.excerpt(i.event) : i.kind === "health" ? `Production is ${i.status}` : `${i.author.name} mentioned you · ${i.text.length > 80 ? i.text.slice(0, 79) + "…" : i.text}`,
  // `Inbox#search`: the session's title, the repository, the tool and what the call says; a note's words.
  matches(i: InboxItem, q: string) {
    if (!q) return true;
    const fields =
      i.kind === "call" ? [i.place.title, i.place.repo, Tools.name(i.event.tool), i.event.content] : i.kind === "health" ? [i.environment, i.repo, ...i.reasons] : [i.place.title, i.text];
    return fields.some((f) => f.toLowerCase().includes(q.toLowerCase()));
  },
  // `RunsHelper::FACES` for a call, the @ face for a mention.
  glyph(i: InboxItem) {
    if (i.kind === "health") return "terminal";
    if (i.kind !== "call") return "at";
    return ({ create_pull_request: "branch", push_branch: "upload", ask_user: "gate" } as Record<string, string>)[Tools.name(i.event.tool)] ?? "terminal";
  },
  // The verdict once decided, Handled once a mention is; nothing while it waits.
  verdict(i: InboxItem): { text: string; tone: Tone } | undefined {
    if (i.kind === "call") {
      if (i.event.approvalStatus === "pending") return undefined;
      const [text, tone] = Tools.verdict(i.event);
      return { text, tone };
    }
    if (i.kind === "health") return i.resolved ? { text: "Resolved", tone: "green" } : { text: i.status === "down" ? "Down" : "Degraded", tone: i.status === "down" ? "red" : "orange" };
    return i.handled ? { text: "Handled", tone: "green" } : undefined;
  },
  // The latest call decided, said in a line: "Allowed Add /health endpoint, by Ben, 2d ago".
  lastDecision(items: InboxItem[], now: Date): string | undefined {
    let last: EventRecord | undefined;
    for (const i of items) {
      if (i.kind === "call" && i.event.approvalStatus !== "pending" && i.event.decidedAt && (!last || Date.parse(i.event.decidedAt) > Date.parse(last.decidedAt!))) last = i.event;
    }
    if (!last) return undefined;
    const by = last.decidedBy?.name;
    return [`${Tools.verdict(last)[0]} ${Tools.excerpt(last).toLowerCase()}`, by && `by ${by}`, `${words.age(last.decidedAt!, now)} ago`].filter(Boolean).join(", ");
  },
  // The conversation's title over the request, the verdict, where it waits and how long ago it was asked.
  row(i: InboxItem, now: Date): DayRow {
    const at = inboxItem.createdAt(i);
    if (i.kind === "health") {
      return {
        id: i.id, glyph: inboxItem.glyph(i), title: inboxItem.title(i), line: { sub: i.reasons.join(" · ") }, off: i.resolved,
        pill: inboxItem.verdict(i), owner: i.owner, repo: project({ name: i.repo }), environment: i.environment, age: words.age(at, now),
      };
    }
    return {
      id: inboxItem.id(i), glyph: inboxItem.glyph(i), title: inboxItem.title(i), line: { over: i.place.title }, off: !inboxItem.waiting(i),
      pill: inboxItem.verdict(i), owner: i.place.owner, repo: project({ name: i.place.repo }), environment: i.place.environment ?? null,
      age: words.age(at, now),
    };
  },
};

export type InboxScreenProps = {
  items: Load<InboxItem[]>;
  query?: string;
  answered?: boolean;
  // The call shown in the gate dialog.
  open?: InboxItem;
  now?: Date;
  // A decision that failed, in the API's words.
  error?: string;
  // Allows, denies or dismisses a call (`POST /sessions/{id}/approvals`).
  decide?: (item: InboxItem, allow: boolean) => void;
  // Sends a question's answers and notes.
  answer?: (item: InboxItem, answer: GateAnswer) => void;
  dismissError?: () => void;
  // Loads the list again after it failed.
  retry?: () => void;
};

// What waits on you: approvals and questions from agents, and notes that mention you, by day. A row opens its
// conversation; a call's menu decides it here.
export function InboxScreen({ items, query: initialQuery = "", answered: initialAnswered = false, open: initialOpen, now = new Date(), error, decide = () => {}, answer = () => {}, dismissError, retry }: InboxScreenProps) {
  const navigate = useNavigate();
  const strip = useContext(ShowsTabStrip);
  const [query, setQuery] = useState(initialQuery);
  const [view, setView] = useState(initialAnswered ? "Answered too" : "Waiting");
  const [open, setOpen] = useState<PlacedItem | undefined>(initialOpen?.kind === "health" ? undefined : initialOpen);
  const all = load.get(items) ?? [];
  const answered = view === "Answered too";
  const decided = inboxItem.lastDecision(all, now);
  const kept = all.filter((i) => (answered || inboxItem.waiting(i)) && inboxItem.matches(i, query.trim()));
  const byId = new Map(kept.map((i) => [inboxItem.id(i), i]));
  const go = (i: InboxItem) =>
    i.kind === "health" ? navigate(paths.environment(i.environmentId), "here", i.environment) : navigate(paths.session(i.place.sessionId), "here", i.place.title);
  return (
    <div className="relative flex h-full flex-col bg-page">
      {strip && <TabStrip tabs={[{ title: "Sessions", glyph: "session" }, { title: "Inbox", glyph: "inbox" }]} active={1} />}
      <div className="min-h-0 flex-1">
        <ListPage
          title="Inbox"
          glyph="inbox"
          state={load.list(items)}
          total={all.length}
          shown={kept.length}
          query={query}
          onQuery={setQuery}
          filtered={decided ? `Nothing waits on you. Last decision: ${decided}.` : "Nothing waits on you."}
          reset={() => setView("Answered too")}
          empty={listEmpty("gate", {
            noun: "request",
            plural: "requests and mentions",
            title: "Nothing waits on you",
            text: "Approvals and questions from your agents, and notes that mention you, land here until you answer them.",
          })}
          retry={retry}
          count={answered ? all.length : all.filter(inboxItem.waiting).length}
          filters={
            <div className="shrink-0" style={{ width: fieldSize.small.width }}>
              <SelectInput placeholder="Choose a view" options={["Waiting", "Answered too"]} selection={view} onChange={setView} glyph="gate" size="small" />
            </div>
          }
          rows={
            <DayList
              groups={sessionState.days(kept, now, inboxItem.createdAt).map(([title, list]) => ({ title, rows: list.map((i) => inboxItem.row(i, now)) }))}
              open={(r) => {
                const i = byId.get(r.id);
                if (i) go(i);
              }}
              menu={(r) => {
                const i = byId.get(r.id);
                if (!i || i.kind !== "call") return [];
                return [
                  menu.item("Go to conversation", { glyph: "session", action: () => go(i) }),
                  menu.item(inboxItem.waiting(i) ? "Decide here" : "See the verdict", { glyph: "gate", action: () => setOpen(i) }),
                ];
              }}
            />
          }
        />
      </div>
      {open ? (
        <GateDialog
          item={open}
          decide={(allow) => {
            decide(open, allow);
            setOpen(undefined);
          }}
          answer={(a) => {
            answer(open, a);
            setOpen(undefined);
          }}
          close={() => setOpen(undefined)}
        />
      ) : (
        error && (
          <ToastLayer>
            <Toast text={error} tone="red" close={dismissError} />
          </ToastLayer>
        )
      )}
    </div>
  );
}

export type GateDialogProps = {
  item: PlacedItem;
  // The questions' choices by option index, as a sample shows them.
  picks?: Record<number, Set<number>>;
  decide?: (allow: boolean) => void;
  answer?: (answer: GateAnswer) => void;
  close?: () => void;
};

// An Inbox call in a dialog: to decide it while it waits, what came back once decided, and the way to its
// conversation.
export function GateDialog({ item, picks: initialPicks = {}, decide = () => {}, answer = () => {}, close = () => {} }: GateDialogProps) {
  const navigate = useNavigate();
  const [picks, setPicks] = useState(initialPicks);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const event = item.kind === "call" ? item.event : undefined;
  const questions = event ? Tools.questions(event) : [];
  const pending = event?.approvalStatus === "pending";
  const asking = pending && questions.length > 0;
  const reply = GateAnswer.of(questions, picks, notes);
  return (
    <Dialog
      title={item.place.title}
      glyph="gate"
      close={close}
      footer={
        <>
          <Button kind="ghost" size="small" glyph="session" onClick={() => navigate(paths.session(item.place.sessionId), "here", item.place.title)}>
            Open the conversation
          </Button>
          {asking ? (
            <>
              <Button kind="quiet" size="small" onClick={() => decide(false)}>
                Dismiss
              </Button>
              <Button kind="primary" size="small" disabled={!GateAnswer.complete(reply, questions.length)} onClick={() => answer(reply)}>
                Continue
              </Button>
            </>
          ) : (
            <Button size="small" onClick={close}>
              Close
            </Button>
          )}
        </>
      }
    >
      {event && (
        <div className="flex flex-col items-stretch gap-3">
          {pending ? (
            questions.length === 0 ? (
              // Allow before Deny, everywhere.
              <Approval title={Tools.action(event, item.place.branch)} tool={Tools.label(event)} detail="" allow={() => decide(true)} deny={() => decide(false)} />
            ) : (
              questions.map((q, i) => (
                <Question
                  key={i}
                  agent={item.place.agent}
                  question={q}
                  step={questions.length > 1 ? `${i + 1} of ${questions.length}` : ""}
                  selection={picks[i] ?? new Set()}
                  onSelect={(p) => setPicks({ ...picks, [i]: p })}
                  note={notes[i] ?? ""}
                  onNote={(t) => setNotes({ ...notes, [i]: t })}
                  keys={questions.length === 1}
                />
              ))
            )
          ) : (
            <>
              <Notice text={[Tools.verdict(event)[0], event.decidedBy?.name, words.hm(event.decidedAt ?? event.createdAt)].filter(Boolean).join(" · ")} tone={Tools.verdict(event)[1]} />
              <TerminalBlock
                lines={(event.outcome ?? (questions.length ? questions.map((q) => q.question).join("\n") : Tools.action(event, item.place.branch))).split("\n").map((text) => ({ text }))}
              />
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
