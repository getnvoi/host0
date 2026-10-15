// A session's tab on the plane: the conversation and what shows beside it, read again whenever the stream names the
// session. The path names it: /sessions/:id/preview (the preview in the pane), /sessions/:id/changes|terminal (a tool
// in the drawer).
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  ConversationScreen, ConversationSkeleton, ErrorState, load, paths, Terminal, useDelayedBusy, useNavigate, viewPaths, WebFrame,
  type ChangesRecord, type FilesRecord, type Load, type SessionDetail, type TurnRecord,
} from "@hz/ui";
import { openUrl } from "../../api/client";
import { stale, useApi, useReconnecting, useWrite } from "../../api/live";
import type { Approval, Changes, PreviewStatus, Session } from "../../api/models";
import { message, pullRequestOf, sessionOf, sessions as api, turnsOf } from "../../api/session";
import { useShellTransport } from "../../api/shell";
import { store } from "../../store";
import { useStarting } from "./sessions";
import { listen } from "./dictation";

const failed = <T,>(e: unknown): Load<T> => load.failed(message(e));
// How far this clock may be ahead of the plane's when a sent message is matched to the turn the session reads.
const clockSlack = 10_000;
// A preview link is asked for again before its token runs out.
const RENEW = 45 * 60_000;

export function SessionPage() {
  const { id = "", view: named } = useParams();
  const view = Math.max(0, viewPaths.indexOf((named ?? "") as (typeof viewPaths)[number]));
  const navigate = useNavigate();
  const read = useApi<Session>(`sessions/${id}`);
  const approvals = useApi<Approval[]>(`approvals?session=${encodeURIComponent(id)}`);
  const queue = useApi<string[]>(`sessions/${id}/queue`);
  const status = useApi<PreviewStatus>(`sessions/${id}/preview`);
  const { environments, repos, agents } = useStarting();
  const transport = useShellTransport(id);
  const reconnecting = useReconnecting();

  const write = useWrite((work: () => Promise<unknown>) => work());
  const [refused, setRefused] = useState<string>();
  const [changes, setChanges] = useState<Load<ChangesRecord>>("loading");
  const [changed, setChanged] = useState(0);
  // The plane serves no file listing: Files says so.
  const files: Load<FilesRecord> = load.failed("Files are not served by this workspace yet.");
  // The preview's signed link, asked for once the app answers, and when it was minted.
  const [preview, setPreview] = useState<string>();
  const minted = useRef(0);
  const up = !!status.data?.up;

  // Messages sent and not yet in the plane's answer: shown at once until the session read after the send holds them.
  const [sending, setSending] = useState<TurnRecord[]>([]);
  const [decided, setDecided] = useState<Record<string, "approved" | "rejected">>({});

  const s = read.data;
  useEffect(() => {
    if (!s || !up || (preview && Date.now() - minted.current < RENEW)) return;
    let live = true;
    api.preview(s.preview).then(
      (p) => {
        if (!live) return;
        minted.current = Date.now();
        setPreview(p.url);
      },
      (e) => live && setRefused(`No preview link: ${message(e)}`),
    );
    return () => void (live = false);
  }, [s?.preview, up, preview]);

  const turns = s ? turnsOf(s, approvals.data ?? [], queue.data ?? []) : [];
  const waiting = sending.filter((x) => !turns.some((t) => t.prompt === x.prompt && Date.parse(t.createdAt) >= Date.parse(x.createdAt) - clockSlack));
  const ahead = (t: TurnRecord): TurnRecord => ({
    ...t,
    events: t.events.map((e) => (e.toolUseId && decided[e.toolUseId] && e.approvalStatus === "pending" ? { ...e, approvalStatus: decided[e.toolUseId] } : e)),
  });
  const session = s ? sessionOf(s, environments) : undefined;
  const environment = environments.find((e) => e.name === s?.env);
  const detail: SessionDetail | undefined =
    s && session
      ? {
          session: { ...session, worktree: { ...session.worktree, serving: up, pullRequest: pullRequestOf(s, changed) } },
          agent: agents[0] ?? { id: "", name: "Agent", slug: "agent" },
          repo: repos.find((r) => r.id === environment?.repo) ?? { id: "", name: s.env, owner: "", environments: [{ id: s.env, name: s.env, providerName: "" }] },
          turns: [...turns.map(ahead), ...waiting],
          notes: [],
        }
      : undefined;

  const path = paths.session(id) + (viewPaths[view] ? `/${viewPaths[view]}` : "");
  useEffect(() => {
    if (session) store.retitle(path, session.title);
  }, [path, session?.title]);

  const loadChanges = () =>
    api
      .changes(id)
      .then((c: Changes) => {
        setChanged(c.files?.length ?? 0);
        setChanges(load.value({ patch: c.patch ?? "", patchAt: c.at, baseRef: c.base }));
      })
      .catch((e) => setChanges(failed(e)));

  // The pull request button counts the changed files: they are read on opening, and again when a turn ends.
  useEffect(() => {
    setChanged(0);
    void loadChanges();
  }, [id]);
  const was = useRef<string>(undefined);
  useEffect(() => {
    const prior = was.current;
    was.current = s?.state;
    if (prior && prior !== "idle" && s?.state === "idle") void loadChanges();
  }, [s?.state]);

  // Runs an action; a failure is shown as `what`, then the plane's sentence. The session is read again after it.
  const act = (what: string, work: () => Promise<unknown>) =>
    write
      .mutateAsync(work)
      .then(() => setRefused(undefined))
      .catch((e) => setRefused(`${what}: ${message(e)}`))
      .finally(() => stale(`sessions/${id}`));

  const held = useDelayedBusy(!detail, !!read.error && !read.data);
  if (!detail) {
    if (read.error && !read.data) {
      return (
        <div className="flex h-full items-center justify-center bg-page">
          <ErrorState title="This session could not be loaded" message={message(read.error)} retry={() => void read.refetch()} />
        </div>
      );
    }
    return <ConversationSkeleton />;
  }
  if (held) return <ConversationSkeleton />;

  return (
    <ConversationScreen
      key={id}
      draft={store.draft.get(id).text}
      onDraftChange={(text) => store.draft.set(id, { text })}
      note={false}
      detail={detail}
      reconnecting={reconnecting}
      view={view}
      error={refused}
      panes={{ changes, files, preview, serve: status.error ? failed(status.error) : up ? undefined : s?.state === "forking" ? "loading" : undefined }}
      previewFrame={preview ? <WebFrame flush state={{ running: preview }} /> : undefined}
      terminal={<Terminal transport={transport} open={(url) => void openUrl(url)} />}
      actions={{
        send: (prompt, to) => {
          // Behind a turn at work, the plane queues it: it shows queued from the start.
          const behind = !!s && ["forking", "running", "awaiting_approval"].includes(s.state);
          const turn: TurnRecord = { id: `sending ${crypto.randomUUID()}`, ahead: true, prompt, status: behind ? "queued" : "pending", createdAt: new Date().toISOString(), events: [] };
          setSending((all) => [...all, turn]);
          void act("Not sent", () => api.say(id, prompt, to)).finally(() => setSending((all) => all.filter((t) => t !== turn)));
        },
        dictate: listen,
        decide: (call, allow) => {
          setDecided((all) => ({ ...all, [call]: allow ? "approved" : "rejected" }));
          void act(allow ? "Not approved" : "Not denied", () => api.decide(call, allow)).finally(() =>
            setDecided((all) => {
              const { [call]: _, ...rest } = all;
              return rest;
            }),
          );
        },
        // A queued message leaves the queue; the running turn stops.
        cancel: (turn) => {
          const queued = turn.startsWith("queued-") ? Number(turn.slice("queued-".length)) : undefined;
          if (queued !== undefined) void act("Not withdrawn", () => api.unqueue(id, queued, queue.data?.[queued] ?? ""));
          else void act("Not stopped", () => api.stop(id));
        },
        openLink: (url) => void openUrl(url),
        reloadPreview: () => setPreview(undefined),
        view: (v) => {
          if (v !== view) navigate(paths.session(id) + (viewPaths[v] ? `/${viewPaths[v]}` : ""), "here", detail.session.title);
          if (v === 3) void loadChanges();
        },
        dismissError: () => setRefused(undefined),
      }}
    />
  );
}
