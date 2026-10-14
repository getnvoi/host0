import { useEffect, useRef, useState } from "react";
import { copiedFor } from "./glyph";
import { Button } from "./primitives";

export type MessageActionsProps = {
  // What Copy puts on the clipboard.
  text: string;
  retry?: () => void;
  quote?: () => void;
  // Drawn as when the pointer is over the message, for the gallery.
  shown?: boolean;
};

// Under an agent's message: copy it, run the turn again, quote it into the composer. Hidden until the message is
// hovered (its group), then at rest.
export function MessageActions({ text, retry, quote, shown }: MessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = () => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), copiedFor);
  };
  return (
    <div
      data-testid="message:actions"
      className={`flex items-center gap-0.5 transition-opacity duration-[120ms] ${shown ? "opacity-100" : "opacity-0 group-hover/message:opacity-100 focus-within:opacity-100"}`}
    >
      <Button kind="ghost" size="mini" glyph="copy" copied={copied} onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </Button>
      {retry && (
        <Button kind="ghost" size="mini" glyph="retry" onClick={retry}>
          Retry
        </Button>
      )}
      {quote && (
        <Button kind="ghost" size="mini" glyph="quote" onClick={quote}>
          Quote
        </Button>
      )}
    </div>
  );
}
