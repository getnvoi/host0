import { backoff } from "@/lib/backoff";

test("doubles from the base and stops at the cap", () => {
  expect([0, 1, 2, 3, 4, 5, 6].map((n) => backoff(n, 1000, 30_000))).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]);
  expect([0, 1, 2, 3].map((n) => backoff(n, 10_000, 60_000))).toEqual([10_000, 20_000, 40_000, 60_000]);
});
