import { byDay } from "@/lib/days";
import type { Summary } from "@/contexts/api/types";

const at = (last: string): Summary =>
  ({ id: last, env: "e", branch: "b", preview: "p", state: "idle", prompt: "x", queued: 0, at: last, last }) as Summary;

test("groups by local day, today first", () => {
  const now = new Date(2026, 8, 25, 12);
  const days = byDay(
    [at(new Date(2026, 8, 25, 9).toISOString()), at(new Date(2026, 8, 24, 23).toISOString()), at(new Date(2026, 8, 25, 1).toISOString())],
    now,
  );
  expect(days.map((d) => [d.age, d.sessions.length])).toEqual([
    [0, 2],
    [1, 1],
  ]);
});
