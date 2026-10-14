// Every shortcut, as the app and the composer hear them: the commander runs the composer's, and the shortcuts dialog
// lists them all. "Capture the preview" (⌘⇧P) and "Add a workflow" (⌘⇧W) join once they do something.
export type Shortcut = { title: string; keys: string[] };

// The composer's, as it hears them (composer.tsx): `key` and `shift` replay one from the commander; `queued`: only
// while a turn is queued.
export type ComposerShortcut = Shortcut & { lead: string; key: string; shift: boolean; queued?: boolean };

export const composerShortcuts: ComposerShortcut[] = [
  { title: "Attach files", lead: "clip", keys: ["⌘", "U"], key: "u", shift: false },
  { title: "Write a note to the team", lead: "pin", keys: ["⌘", "⇧", "N"], key: "n", shift: true },
  { title: "Stop the queued turn", lead: "stop", keys: ["⌘", "."], key: ".", shift: false, queued: true },
];

export const shortcutGroups: { title: string; rows: Shortcut[] }[] = [
  {
    title: "Anywhere",
    rows: [
      { title: "Open the commander", keys: ["⌘", "K"] },
      { title: "Open a page in a new tab", keys: ["⌘", "T"] },
      { title: "Start a session", keys: ["⌘", "N"] },
      { title: "Close the tab", keys: ["⌘", "W"] },
    ],
  },
  {
    title: "Composer",
    rows: [
      { title: "Send", keys: ["↵"] },
      { title: "A new line", keys: ["⇧", "↵"] },
      ...composerShortcuts.map(({ title, keys }) => ({ title, keys })),
      { title: "Mention someone in a note", keys: ["@"] },
      { title: "Stop dictating", keys: ["Esc"] },
    ],
  },
  {
    title: "An approval or a question",
    rows: [
      { title: "Allow, or answer", keys: ["↵"] },
      { title: "Deny, or dismiss", keys: ["Esc"] },
    ],
  },
];
