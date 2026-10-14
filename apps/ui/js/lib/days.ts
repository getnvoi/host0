import type { Summary } from "@/contexts/api/types";

// Sessions by the local day of their last activity, newest day first; a day's rows keep the order they came in.
export type Day = { key: string; age: number; sessions: Summary[] };

export function byDay(sessions: Summary[], now = new Date()): Day[] {
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = midnight(now);
  const days = new Map<string, Day>();
  for (const s of sessions) {
    const at = new Date(s.last);
    const key = at.toDateString();
    const age = Math.round((today - midnight(at)) / 86_400_000);
    const day = days.get(key) ?? { key, age, sessions: [] };
    day.sessions.push(s);
    days.set(key, day);
  }
  return [...days.values()].sort((a, b) => a.age - b.age);
}
