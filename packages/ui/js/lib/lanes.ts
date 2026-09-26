import type { State, Summary } from "@/contexts/api/types";

// The board: where a session is, by what it needs next.
export const LANES = ["running", "waiting", "idle", "failed"] as const;
export type Lane = (typeof LANES)[number];

const LANE: Record<State, Lane> = {
  forking: "running",
  running: "running",
  awaiting_approval: "waiting",
  idle: "idle",
  failed: "failed",
};

export function lane(s: Summary): Lane {
  return LANE[s.state];
}
