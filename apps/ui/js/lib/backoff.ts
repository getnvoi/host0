// The wait before retry n (from 0): base, doubled each time, never more than cap.
export function backoff(n: number, base: number, cap: number): number {
  return Math.min(cap, base * 2 ** Math.max(0, n));
}
