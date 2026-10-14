type Page = Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;

// Calls away once the page has been hidden for ms, and back when it shows again after that. Returns the disposer.
export function watchAway(ms: number, on: { away: () => void; back: () => void }, page: Page = document): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let gone = false;
  const change = () => {
    clearTimeout(timer);
    if (page.hidden) {
      timer = setTimeout(() => {
        gone = true;
        on.away();
      }, ms);
    } else if (gone) {
      gone = false;
      on.back();
    }
  };
  page.addEventListener("visibilitychange", change);
  change();
  return () => {
    clearTimeout(timer);
    page.removeEventListener("visibilitychange", change);
  };
}
