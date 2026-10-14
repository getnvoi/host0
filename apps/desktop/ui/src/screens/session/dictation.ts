import { useRef, useState } from "react";

// The app's recognizer: starts listening and answers how to stop it. `heard` gets the words said so far, `ended` why
// it stopped when it could not listen.
export type Dictate = (heard: (words: string) => void, ended: (refused?: string) => void) => () => void;

// Dictation into a draft, for any page with a composer. The words said land after the draft as it was when dictation
// started, replaced as they settle. `toggle` starts or stops it; `listening` while it hears; `refused` why it could not,
// until `dismiss`; `settle` before sending, so what the recognizer settles after does not fill the emptied box again.
export function useDictation(dictate: Dictate | undefined, draft: string, setDraft: (text: string) => void, start?: { listening?: boolean; refused?: string }) {
  const [listening, setListening] = useState<{ stop: () => void } | undefined>(start?.listening ? { stop: () => {} } : undefined);
  const [refused, setRefused] = useState(start?.refused);
  const on = useRef(false);
  const toggle = () => {
    if (listening) return listening.stop();
    if (!dictate) return;
    const before = draft.trim();
    setRefused(undefined);
    on.current = true;
    const stop = dictate(
      (words) => on.current && setDraft([before, words.trim()].filter(Boolean).join(" ")),
      (why) => {
        setListening(undefined);
        if (why) setRefused(why);
      },
    );
    setListening({ stop });
  };
  const settle = () => {
    on.current = false;
    listening?.stop();
  };
  return { toggle, listening: !!listening, refused, dismiss: () => setRefused(undefined), settle };
}
