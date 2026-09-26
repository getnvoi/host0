import { watchAway } from "@/lib/away";

// A page that can be hidden and shown, without a DOM.
class Page extends EventTarget {
  hidden = false;
  set(hidden: boolean) {
    this.hidden = hidden;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("away after the page stays hidden, back when it shows; a short absence is neither", async () => {
  const page = new Page();
  const calls: string[] = [];
  const stop = watchAway(40, { away: () => calls.push("away"), back: () => calls.push("back") }, page as unknown as Document);
  page.set(true);
  await wait(10);
  page.set(false);
  await wait(60);
  expect(calls).toEqual([]);
  page.set(true);
  await wait(60);
  expect(calls).toEqual(["away"]);
  page.set(false);
  expect(calls).toEqual(["away", "back"]);
  stop();
});
