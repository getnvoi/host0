import type { Person } from "../../primitives";
import type { DayRow } from "../../data";
import type { BoardCardSpec, BoardLane } from "../../start";
import type { Tone } from "../../tokens";
import { project, words, type RepoRecord, type SessionRecord } from "./records";

// How a session reads in a list: the reason it needs attention and its tone, from `status`, the machine's
// `worktree.state` and its pull request.
export const sessionState = {
  of(s: SessionRecord): [string, Tone] {
    if (s.worktree.state === "failed") return ["Setup failed", "red"];
    if (s.status === "waiting") return ["Waiting on you", "yellow"];
    if (s.status === "running") return s.worktree.state === "starting" ? ["Setting up the machine", "orange"] : ["Working", "blue"];
    if (s.worktree.pullRequest?.state === "merged") return ["Pull request merged", "green"];
    if (s.worktree.pullRequest?.state === "open") return ["Pull request open", "grey"];
    return ["Idle", "grey"];
  },

  // The session as a day list row: its state on the lead and the line, its repository, environment and age. A
  // search's excerpt takes the line; the lead keeps the state's tone.
  row(s: SessionRecord, repos: RepoRecord[], now: Date): DayRow {
    const repo = repos.find((r) => r.id === s.repoId);
    const [reason, tone] = sessionState.of(s);
    const line = s.excerpt ? { sub: s.excerpt, lineTone: "grey" as Tone } : { sub: reason, lineTone: tone === "green" ? "grey" : tone };
    return {
      id: s.id, glyph: "session", tone, title: s.title, line: { sub: line.sub }, lineTone: line.lineTone, off: s.archived,
      owner: repo?.owner ?? "", repo: repo ? project(repo) : "", environment: repo?.environments.find((e) => e.id === s.environmentId)?.name ?? null,
      age: words.age(s.updatedAt, now), tab: s.tab, people: sessionState.people(s),
    };
  },

  // Who wrote in it, as avatars.
  people: (s: SessionRecord): Person[] => (s.people ?? []).map((p) => ({ initials: words.initials(p.name), name: p.name, src: p.picture })),

  // Lanes by `status`, as `SessionResource#status` lanes them: working, waiting on you, idle.
  lanes(sessions: SessionRecord[], repos: RepoRecord[], now: Date): BoardLane[] {
    const lanes: [string, string, Tone][] = [["running", "Working", "blue"], ["waiting", "Waiting on you", "yellow"], ["idle", "Idle", "grey"]];
    return lanes.map(([status, name, tone]) => ({
      name,
      tone,
      cards: sessions
        .filter((s) => s.status === status)
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .map((s) => sessionState.card(s, repos, now)),
    }));
  },

  // The session as a board card: its state unless it is plainly idle, its repository, a pull request, its age.
  card(s: SessionRecord, repos: RepoRecord[], now: Date): BoardCardSpec {
    const repo = repos.find((r) => r.id === s.repoId);
    const [reason, tone] = sessionState.of(s);
    const shown = s.status === "idle" && tone === "grey" ? undefined : { word: reason, tone, spin: s.status === "running" };
    return { id: s.id, title: s.title, state: shown, owner: repo?.owner ?? "", repo: repo ? project(repo) : "", kind: s.worktree.pullRequest?.url ? "PR" : undefined, age: words.age(s.updatedAt, now), tab: s.tab, people: sessionState.people(s) };
  },

  // Newest first, by the day of their last activity (`WorktreeSession#day_group`).
  days<T>(items: T[], now: Date, at: (t: T) => string): [string, T[]][] {
    const out: [string, T[]][] = [];
    for (const item of [...items].sort((a, b) => Date.parse(at(b)) - Date.parse(at(a)))) {
      const day = words.day(at(item), now);
      const last = out[out.length - 1];
      if (last && last[0] === day) last[1].push(item);
      else out.push([day, [item]]);
    }
    return out;
  },
};
