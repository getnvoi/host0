import { Dialog } from "./heads";
import { GroupTitle, Kbd } from "./primitives";
import type { shortcutGroups } from "./screens/shortcuts";

// Every shortcut, by where it acts: each a line with what it does on the left and its keys on the right. The composer's
// info button opens it.
export function ShortcutsDialog({ groups, close }: { groups: typeof shortcutGroups; close: () => void }) {
  return (
    <Dialog title="Shortcuts" glyph="info" close={close} footer={false}>
      <div className="flex flex-col gap-5">
        {groups.map((g) => (
          <div key={g.title} className="flex flex-col">
            <GroupTitle title={g.title} />
            {g.rows.map((r) => (
              <div key={r.title} className="flex h-9 items-center justify-between gap-4">
                <span className="truncate text-[14px] text-ink">{r.title}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {r.keys.map((k) => (
                    <Kbd key={k} k={k} />
                  ))}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Dialog>
  );
}
