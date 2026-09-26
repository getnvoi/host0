import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import { Icon } from "./icon";
import { Prose } from "./prose";
import { Status } from "./status";

// A file attached to a message: `src` is an image preview, `attrs` go on the link (such as a lightbox action).
export type MessageFile = { name: string; src?: string; href?: string; attrs?: HTMLAttributes<HTMLElement> };

// The file's extension in up to five letters, else "file", as Ruby's File.extname reads it.
function extension(name: string): string {
  const base = name.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return (dot > 0 && base.slice(dot + 1, dot + 6)) || "file";
}

// Ds::Message: your own message in a session, the you face, your name and the time, the words on a g2 wash and what
// you attached as square thumbnails. A queued message is dashed and says it waits for the turn to end.
export type MessageProps = {
  name?: string;
  time?: ReactNode;
  files?: MessageFile[];
  queued?: boolean;
  agent?: string;
  action?: ReactNode;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children">;

export function Message({
  name = "You", time, files = [], queued = false, agent = "the agent", action, className, children, ...rest
}: MessageProps) {
  return (
    <article className={cx("ds-message", className, { "is-queued": queued })} {...rest}>
      <Icon name="you" size={24} />
      <div className="ds-message-main">
        <div className="ds-message-who">
          <span className="ds-message-name">{name}</span>
          {queued ? (
            <Status className="ds-message-queued">{`Queued until ${agent} finishes`}</Status>
          ) : (
            time != null && <span className="ds-message-time">{time}</span>
          )}
          {action != null && <span className="ds-message-action">{action}</span>}
        </div>
        {children != null && children !== false && (
          <div className="ds-message-box">
            <Prose>{children}</Prose>
          </div>
        )}
        {files.length > 0 && (
          <ul className="ds-message-files" aria-label="Attachments">
            {files.map((file, i) => (
              <li key={i}>
                <Thumb file={file} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

function Thumb({ file }: { file: MessageFile }) {
  const body = (
    <>
      {file.src ? <img src={file.src} alt="" /> : <span className="ds-message-ext">{extension(file.name)}</span>}
      <span className="ds-message-file-name">{file.name}</span>
    </>
  );
  if (file.href) {
    return (
      <a href={file.href} className="ds-message-file" title={file.name} {...file.attrs}>
        {body}
      </a>
    );
  }
  return (
    <span className="ds-message-file" title={file.name}>
      {body}
    </span>
  );
}
