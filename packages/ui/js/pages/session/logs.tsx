import { useEffect, useState } from "react";
import { useTranslations } from "@/contexts/i18n";
import { messageFrom } from "@/contexts/api/errors";
import { readLog, useLogSources } from "@/contexts/api/sessions";
import { watchAway } from "@/lib/away";
import { Drawer } from "@/ds/drawer";
import { Log } from "@/ds/log";
import { Segmented } from "@/ds/segmented";

// Terminal colour and cursor codes, which a log shown as text drops.
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

// The sandbox's setup and service output, followed every two seconds while shown and the page is in view.
export function Logs({ session, subtitle, name, onPick, onClose }: { session: string; subtitle: string; name: string; onPick: (name: string) => void; onClose: () => void }) {
  const { t } = useTranslations();
  const sources = useLogSources(session, true);
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();

  useEffect(() => {
    let offset = 0;
    let live = true;
    // Hidden for a minute: polling rests until the page shows again, from the same offset.
    let paused = false;
    let reading = false;
    let timer: ReturnType<typeof setTimeout>;
    setText("");
    setError(undefined);
    const poll = async () => {
      reading = true;
      try {
        const { text: raw, next } = await readLog(session, name, offset);
        const more = raw.replace(ANSI, "");
        if (!live) return;
        offset = next;
        if (more) setText((x) => (x + more).slice(-2_000_000));
        setError(undefined);
      } catch (e) {
        if (live) setError(messageFrom(e, t));
      } finally {
        reading = false;
      }
      if (live && !paused) timer = setTimeout(poll, 2000);
    };
    poll();
    const stop = watchAway(60_000, {
      away: () => {
        paused = true;
        clearTimeout(timer);
      },
      back: () => {
        paused = false;
        if (!reading) poll();
      },
    });
    return () => {
      live = false;
      clearTimeout(timer);
      stop();
    };
  }, [session, name, t]);

  // Lines, as ds Log takes them; the last one is dropped while it is still being written.
  const lines = text ? text.replace(/\n$/, "").split("\n") : [];
  return (
    <Drawer
      id="logs"
      open
      flush
      width={720}
      title={t("logs.title")}
      text={subtitle}
      onClose={onClose}
      actions={
        sources.data &&
        sources.data.length > 1 && (
          <Segmented
            size="sm"
            label={t("logs.sources")}
            value={name}
            onChange={onPick}
            items={sources.data.map((s) => ({ value: s.name, label: s.kind === "setup" ? t("logs.setup") : s.name }))}
          />
        )
      }
    >
      <Log lines={lines} edge={false} empty={error ?? t("logs.empty")} />
    </Drawer>
  );
}
