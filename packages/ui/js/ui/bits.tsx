import { useEffect, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Face, type Family } from "@/ui/marks";

export function Empty({
  icon,
  family = "gray",
  title,
  text,
  action,
  dashed = true,
}: {
  icon: LucideIcon;
  family?: Family;
  title: string;
  text?: string;
  action?: ReactNode;
  dashed?: boolean;
}) {
  return (
    <div className="empty" style={dashed ? undefined : { border: 0, background: "none" }}>
      <Face icon={icon} family={family} size={44} />
      <h3 className="empty-title">{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

// Shown only after 300ms, so a fast answer never flashes a placeholder.
export function Skeleton({ rows = 3, widths = ["60%", "85%", "40%"] }: { rows?: number; widths?: string[] }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 300);
    return () => clearTimeout(t);
  }, []);
  if (!shown) return null;
  return (
    <div className="skeleton" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="bone" style={{ width: widths[i % widths.length] }} />
      ))}
    </div>
  );
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function Alert({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="alert" role="alert">
      <Icon />
      <div className="grow">
        <b>{title}</b>
        {children}
      </div>
    </div>
  );
}

// Seconds since a moment, ticking once a second while shown.
export function useElapsed(from?: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!from) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [from]);
  return from ? Math.max(0, now - new Date(from).getTime()) : 0;
}
