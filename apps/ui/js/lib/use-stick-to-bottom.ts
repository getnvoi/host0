import { useCallback, useEffect, useRef, useState } from "react";

// A transcript follows new output only while its reader is at the bottom. Scrolled up to read, it stays put and
// offers a way back; nothing moves under someone who is reading.
const SLACK = 48;

export function useStickToBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const stuck = useRef(true);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight <= SLACK;
    stuck.current = bottom;
    setAtBottom(bottom);
  }, []);

  const toBottom = useCallback((smooth = true) => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    stuck.current = true;
    setAtBottom(true);
  }, []);

  useEffect(() => {
    if (stuck.current) toBottom(false);
  }, [dep, toBottom]);

  return { ref, atBottom, onScroll, toBottom };
}
