import type { ReactNode } from "react";
import { Busy, useDelayedBusy } from "./busy";
import { ListLink, SkeletonRows } from "./data";
import { PageHead, PageTabs, SearchField } from "./heads";
import { Surface } from "./surface";
import { Button } from "./primitives";
import { EmptyState, ErrorState } from "./start";
import { measure } from "./tokens";

// Where a list page's data stands.
export type ListState = "loading" | "loaded" | { failed: string };

// What a list page is a list of, and what it says before it has any. `noun` is singular, as the search line names
// it: "No agent matches “x”."
export type ListEmpty = { glyph: string; noun: string; plural: string; title: string; text: string };

export function listEmpty(glyph: string, { noun, plural, title, text }: { noun: string; plural: string; title?: string; text: string }): ListEmpty {
  return { glyph, noun, plural, title: title ?? `No ${plural} yet`, text };
}

export type ListPageProps = {
  title: string;
  glyph: string;
  state: ListState;
  // The search is waiting for its answer.
  searching?: boolean;
  // Pages that share one place, as tabs in the head's centre; the search and filters then lead the body.
  // The head then says the place they share (`title`, `glyph`), not the open page's own name, and no count.
  tabs?: { items: string[]; selection: number; onChange: (i: number) => void; title: string; glyph: string };
  // A long page: a button at the bottom right takes it back to the top.
  scrollTop?: boolean;
  // How many items the list holds as loaded.
  total: number;
  // How many pass the search and the filters.
  shown: number;
  query: string;
  onQuery?: (query: string) => void;
  // Given, the list's foot offers Show archived / Hide archived while it has archived items.
  archived?: boolean;
  onArchived?: (archived: boolean) => void;
  // Archived items exist while the live list is empty.
  anyArchived?: boolean;
  // The line when the extra filters leave nothing; `reset` clears them.
  filtered?: string;
  reset?: () => void;
  empty: ListEmpty;
  retry?: () => void;
  // The head's count when it is not the list's total, such as what waits among all items.
  count?: number;
  filters?: ReactNode;
  action?: ReactNode;
  notice?: ReactNode;
  rows?: ReactNode;
  // Replaces the skeleton rows: a page fills with grey rows while it loads; details below a page use the spinner.
  loading?: ReactNode;
  // With `wide`, a loaded page with items shows `full` across the window in place of the rows.
  wide?: boolean;
  full?: ReactNode;
  // With `wide`, shown across the window while loading (a board's lanes), in place of `loading`.
  fullLoading?: ReactNode;
};

// Every list page: the head (title, glyph, count, search, extra segments, one action) over a body
// `measure.page` wide that is loading, failed, empty, matching nothing, or the page's rows.
export function ListPage(props: ListPageProps) {
  const { title, glyph, state, searching, tabs, scrollTop, total, shown, query, onQuery, archived, anyArchived, empty, count, filters, action, notice, wide, full, fullLoading } = props;
  const loaded = state === "loaded";
  const off = !archived;
  // Nothing loaded and nothing filtered: the page invites its first item and hides the search.
  const first = loaded && total === 0 && !query && off && !anyArchived;
  // The full-width body is showing, so the head's centre narrows to `measure.search`.
  // It stays its minimum once it appeared, as the body's `Busy` does.
  const fullHeld = useDelayedBusy(state === "loading", typeof state === "object");
  const loadsFull = !!wide && (state === "loading" || fullHeld) && fullLoading !== undefined;
  const showsFull = loadsFull || (!!wide && loaded && shown > 0 && full !== undefined);
  const counted = count ?? total;
  const bar = (
    <div className="flex w-full items-center gap-2">
      <SearchField placeholder={`Search ${empty.plural}`} value={query} onChange={onQuery} loading={searching} />
      {filters}
    </div>
  );
  // The full-width body (a board) and the dashed empty state fill the room; a list is the page's column.
  const mode = showsFull ? "flush" : first ? "gutter" : "centered";
  return (
    <Surface
      preset="page"
      className="h-full w-full"
      header={
        <PageHead
          title={tabs?.title ?? title}
          glyph={tabs?.glyph ?? glyph}
          count={!tabs && loaded && counted > 0 ? counted : null}
          width={measure.page}
          center={tabs ? <PageTabs items={tabs.items} selection={tabs.selection} onChange={tabs.onChange} /> : first ? undefined : bar}
          action={action}
        />
      }
      // The search and filters stay under the head while the body scrolls.
      strips={
        tabs ? (
          <div className="mx-auto w-full" style={{ maxWidth: measure.page }}>
            {bar}
          </div>
        ) : undefined
      }
      inset={mode}
      scroll={mode === "centered"}
      scrollTop={scrollTop}
    >
      {showsFull ? (
        loadsFull ? fullLoading : full
      ) : (
        <>
          {!first && notice}
          <Content {...props} first={first} />
        </>
      )}
    </Surface>
  );
}

// The body, and under a loaded list the foot with the archived toggle: shown when the list has archived items (or is
// showing them), at the far right.
function Content(props: ListPageProps & { first: boolean }) {
  const { state, archived, onArchived, anyArchived } = props;
  const foot = state === "loaded" && archived !== undefined && (anyArchived || archived);
  return (
    <>
      <Busy busy={state === "loading"} failed={typeof state === "object"} fallback={props.loading ?? <SkeletonRows count={6} />}>
        <Body {...props} />
      </Busy>
      {foot && <ListLink aside={{ text: archived ? "Hide archived" : "Show archived", glyph: "archive", onClick: () => onArchived?.(!archived) }} />}
    </>
  );
}

function Body({ title, state, total, shown, query, onQuery, archived, onArchived, anyArchived, filtered, reset, empty, retry, action, rows }: ListPageProps & { first: boolean }) {
  if (typeof state === "object") return <ErrorState title={`${title} did not load`} message={state.failed} retry={retry} />;
  if (shown > 0) return rows;
  const off = !archived;
  if (query) {
    return (
      <EmptyState
        text={`No ${empty.noun} matches “${query}”.`}
        action={
          <div className="flex items-center gap-2">
            <Button kind="ghost" size="small" onClick={() => onQuery?.("")}>
              Clear search
            </Button>
            {archived !== undefined && off && anyArchived && (
              <Button kind="ghost" size="small" onClick={() => onArchived?.(true)}>
                Show archived
              </Button>
            )}
          </div>
        }
      />
    );
  }
  if (!off) return <EmptyState glyph="archive" text={`No archived ${empty.plural}.`} />;
  if (total > 0) {
    return (
      <EmptyState
        text={filtered ?? `No ${empty.noun} passes these filters.`}
        action={
          <Button kind="ghost" size="small" onClick={reset}>
            Show all
          </Button>
        }
      />
    );
  }
  if (archived !== undefined && anyArchived) {
    return (
      <EmptyState
        glyph={empty.glyph}
        text={`Every ${empty.noun} is archived.`}
        action={
          <Button kind="ghost" size="small" onClick={() => onArchived?.(true)}>
            Show archived
          </Button>
        }
      />
    );
  }
  return <EmptyState glyph={empty.glyph} title={empty.title} text={empty.text} action={action} />;
}
