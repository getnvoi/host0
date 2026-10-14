import { useRef, useState, type DragEvent, type HTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router";
import { Badge } from "./badge";
import { Button } from "./button";
import { cx } from "./cx";
import { Glyph } from "./glyph";

// Ds::Upload: pick files, from a button or a dashed drop area over a hidden file input. With `url`, picking sends them
// at once in a form built on the body; `url` receives `name` as an array. Without it the input stays in the page's
// form under `name`, and the picked files are listed as rows under the area, each removable, until that form is sent.
// `files` are rows listed before them.
export type UploadProps = {
  url?: string;
  verb?: string;
  name?: string;
  multiple?: boolean;
  accept?: string;
  drop?: boolean;
  variant?: "solid" | "outline" | "line" | "ghost" | "warning" | "danger";
  size?: "md" | "sm";
  glyph?: string;
  // The drop area's icon and its line under the title.
  icon?: string;
  details?: ReactNode;
  // What the control says while the files go up.
  busy?: string;
  loading?: boolean;
  // Off: the rows only, for files that cannot change here.
  picker?: boolean;
  disabled?: boolean;
  files?: ReactNode;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">;

export function Upload({
  url, verb = "post", name = "files", multiple = true, accept, drop = false, variant = "outline", size = "md",
  glyph = "upload", icon, details, busy = "Uploading", loading = false, picker = true, disabled = false, files,
  children, className, ...rest
}: UploadProps) {
  const input = useRef<HTMLInputElement>(null);
  const [kept, setKept] = useState<File[]>([]);
  const [sending, setSending] = useState(0);
  const [over, setOver] = useState(false);
  const attach = url == null;
  const fieldName = multiple && !name.endsWith("[]") ? `${name}[]` : name;
  const hasFiles = present(files) || attach;
  const working = loading || sending > 0;
  // The words say how many files are going up.
  const busyText = sending ? `${busy} ${sending} ${sending === 1 ? "file" : "files"}` : busy;

  const choose = () => {
    if (input.current && !input.current.disabled) input.current.click();
  };

  // Attached: the new picks join the ones kept, a same name replacing the older one, and the input holds them all
  // for the page's form.
  const sync = (list: File[]) => {
    setKept(list);
    const transfer = new DataTransfer();
    list.forEach((file) => transfer.items.add(file));
    if (input.current) {
      input.current.files = transfer.files;
      input.current.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };
  const keep = (picked: File[]) => {
    const names = new Set(picked.map((file) => file.name));
    sync([...kept.filter((file) => !names.has(file.name)), ...picked]);
  };

  const pick = () => {
    const chosen = input.current?.files;
    if (!chosen?.length) return;
    if (attach) return keep([...chosen]);
    setSending(chosen.length);
    send();
  };

  const send = () => {
    const element = input.current;
    if (!element || !url) return;
    const form = document.createElement("form");
    form.action = url;
    form.method = "post";
    form.enctype = "multipart/form-data";
    form.hidden = true;
    const field = (key: string, value: string) => {
      const hidden = document.createElement("input");
      hidden.type = "hidden";
      hidden.name = key;
      hidden.value = value;
      form.append(hidden);
    };
    if (verb && verb !== "post") field("_method", verb);
    const param = document.querySelector<HTMLMetaElement>("meta[name=csrf-param]")?.content;
    const token = document.querySelector<HTMLMetaElement>("meta[name=csrf-token]")?.content;
    if (param && token) field(param, token);
    const copy = element.cloneNode() as HTMLInputElement;
    copy.files = element.files;
    copy.name = fieldName;
    form.append(copy);
    document.body.append(form);
    form.requestSubmit();
  };

  const onOver = (event: DragEvent) => {
    event.preventDefault();
    setOver(true);
  };
  const onLeave = (event: DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    const dropped = [...event.dataTransfer.files];
    if (!dropped.length || !input.current || input.current.disabled) return;
    if (attach) return keep(dropped);
    const transfer = new DataTransfer();
    dropped.slice(0, input.current.multiple ? dropped.length : 1).forEach((file) => transfer.items.add(file));
    input.current.files = transfer.files;
    pick();
  };

  const classes = cx("ds-upload", className, {
    "is-drop": drop, "is-loading": working, "is-disabled": disabled, "is-attach": attach, "has-files": hasFiles, "is-over": over,
  });
  return (
    <div className={classes} {...rest}>
      {picker && (
        <input ref={input} type="file" name={attach ? fieldName : undefined} multiple={multiple} accept={accept} hidden disabled={disabled || undefined} onChange={pick} />
      )}
      {!picker ? null : drop ? (
        <button
          type="button"
          className="ds-upload-drop"
          disabled={disabled || working || undefined}
          aria-busy={working || undefined}
          onDragEnter={onOver}
          onDragOver={onOver}
          onDragLeave={onLeave}
          onDrop={onDrop}
          onClick={choose}
        >
          {working ? <span className="ds-upload-spin" aria-hidden /> : icon && <Glyph name={icon} size={28} className="ds-upload-icon" />}
          <span className="ds-upload-title">{working ? busyText : children || "Drop files here, or browse"}</span>
          {details && <span className="ds-upload-details">{details}</span>}
        </button>
      ) : (
        <Button variant={variant} size={size} glyph={glyph} loading={working} disabled={disabled} onClick={choose}>
          {working ? busyText : children}
        </Button>
      )}
      {hasFiles && (
        <div className="ds-upload-files">
          {files}
          {attach && (
            <div className="ds-upload-picked">
              {kept.map((file, i) => (
                <UploadFile key={file.name} name={file.name} size={measure(file.size)} pending onRemove={() => sync(kept.filter((_, j) => j !== i))} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function present(node: ReactNode) {
  return Array.isArray(node) ? node.some(Boolean) : Boolean(node);
}

function measure(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export type UploadFileProps = {
  name: string;
  size?: ReactNode;
  badge?: ReactNode;
  // A saved file's remove link.
  remove?: { href: string };
  // A picked file not sent yet: its remove is a button that drops it.
  pending?: boolean;
  onRemove?: () => void;
  id?: string;
};

// One file of an upload list: its icon, path in mono, then a badge or its size, then remove.
export function UploadFile({ name, size, badge, remove, pending = false, onRemove, id }: UploadFileProps) {
  const glyph = <Glyph name="close" />;
  let action: ReactNode = <span />;
  if (pending) {
    action = (
      <button type="button" className="ds-upload-file-remove" aria-label={`Remove ${name}`} onClick={onRemove}>
        {glyph}
      </button>
    );
  } else if (remove) {
    const props = { className: "ds-upload-file-remove", "aria-label": `Remove ${name}` };
    action = /^[a-z]+:/.test(remove.href) ? <a href={remove.href} {...props}>{glyph}</a> : <Link to={remove.href} {...props}>{glyph}</Link>;
  }
  return (
    <div className="ds-upload-file" id={id}>
      <Glyph name="note" size={20} />
      <span className="ds-upload-file-name">{name}</span>
      {badge && <Badge kind>{badge}</Badge>}
      {(size || pending) && <span className="ds-upload-file-size">{size}</span>}
      {action}
    </div>
  );
}
