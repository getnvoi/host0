import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ElementType,
  type FormEvent,
  type FormHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router";
import { Count } from "./count";
import { cx } from "./cx";
import { Glyph } from "./glyph";
import { FAMILY, Icon } from "./icon";
import { Tile } from "./tile";

export type HeadSearch = {
  placeholder: string;
  name?: string;
  value?: string;
  label?: string;
  attrs?: InputHTMLAttributes<HTMLInputElement>;
};

// The place the page belongs to, its picture and two lines, the owner over the name.
export type HeadPlace = { name: string; owner?: string; src?: string; href?: string };

// Ds::Head: the page head in three areas, the mark and title on the left, search and filters in the centre, the one
// action on the right. With `back` the mark is the way up; with `centre` the title stands in the middle of the bar.
export type HeadProps = {
  title: string;
  icon?: ComponentProps<typeof Icon>["name"];
  tile?: string;
  count?: number;
  subtitle?: ReactNode;
  back?: string;
  backLabel?: string;
  form?: string;
  // More attributes for the GET form.
  formAttrs?: FormHTMLAttributes<HTMLFormElement>;
  // Search as you type: the form submits 250ms after the last keystroke.
  live?: boolean;
  heading?: ElementType;
  centre?: boolean;
  search?: HeadSearch;
  filters?: ReactNode;
  // In place of the title text: the title as something that acts, such as HeadTitle with `rename`.
  name?: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
  place?: HeadPlace;
} & Omit<HTMLAttributes<HTMLElement>, "title">;

export function Head({
  title,
  icon,
  tile,
  count,
  subtitle,
  back,
  backLabel = "Back",
  form,
  formAttrs = {},
  live = false,
  heading: Heading = "h1",
  centre = false,
  search,
  filters,
  name,
  badge,
  action,
  place,
  className,
  ...rest
}: HeadProps) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const family = icon && ((typeof icon === "string" && FAMILY[icon]) || "gray");
  const mark = tile ? <Tile name={tile} size={28} /> : icon && <Icon name={icon} size={28} />;
  const headingTag = name ?? (
    <Heading className="ds-head-title" title={title}>
      {title}
    </Heading>
  );
  const arrow = (
    <span className="ds-head-arrow">
      <Glyph name="arrow-left" size={14} />
    </span>
  );

  // Our own clear: empties the field and searches again at once.
  const clear = (event: MouseEvent<HTMLButtonElement>) => {
    if (!form) return;
    const input = event.currentTarget.closest(".ds-head-search")?.querySelector("input");
    if (!input) return;
    input.value = "";
    input.focus();
    clearTimeout(timer.current);
    input.form?.requestSubmit();
  };

  // Search as you type: the form submits 250ms after the last keystroke.
  const type: FormHTMLAttributes<HTMLFormElement>["onInput"] = (event) => {
    formAttrs.onInput?.(event);
    const input = event.target as HTMLInputElement;
    if (!live || !input.name) return;
    const element = event.currentTarget;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => element.requestSubmit(), 250);
  };

  let lead: ReactNode;
  if (place) {
    const face = <Tile name={place.name} src={place.src} size={28} decorative />;
    const text = (
      <span className="ds-head-place-text">
        {place.owner && <span className="ds-head-owner">{place.owner}</span>}
        <span className="ds-head-place-name">{place.name}</span>
      </span>
    );
    const at = (inner: ReactNode) =>
      place.href ? (
        <Link to={place.href} className="ds-head-place">
          {inner}
        </Link>
      ) : (
        <span className="ds-head-place">{inner}</span>
      );
    lead = back ? (
      <span className="ds-head-place-with-back">
        <Link to={back} className="ds-head-back is-tile" aria-label={backLabel}>
          <span className="ds-head-face">{face}</span>
          {arrow}
        </Link>
        {at(text)}
      </span>
    ) : (
      at(
        <>
          {face}
          {text}
        </>,
      )
    );
  } else if (back) {
    lead = (
      <Link to={back} className={cx("ds-head-back", { [`ds-f-${family}`]: family, "is-tile": tile })} aria-label={backLabel}>
        <span className="ds-head-face">{mark}</span>
        {arrow}
      </Link>
    );
  } else lead = mark;

  const searchTag = search && (
    <label className="ds-head-search">
      <Glyph name="search" size={14} />
      <input
        type="search"
        name={search.name ?? "q"}
        defaultValue={search.value}
        placeholder={search.placeholder}
        autoComplete="off"
        aria-label={search.label || search.placeholder}
        className="ds-head-search-input"
        {...search.attrs}
      />
      <button type="button" className="ds-head-search-clear" aria-label="Clear search" onClick={clear}>
        <Glyph name="close" size={12} />
      </button>
    </label>
  );
  const center = (search || filters) && (
    <>
      {searchTag}
      {filters}
    </>
  );

  return (
    <header className={cx("ds-head", className, { "is-centre": centre })} {...rest}>
      <div className="ds-head-in">
        <div className="ds-head-lead">
          {lead}
          {!centre && (
            <>
              {subtitle ? (
                <span className="ds-head-stack">
                  <span className="ds-head-over">{subtitle}</span>
                  {headingTag}
                </span>
              ) : (
                headingTag
              )}
              {count != null && <Count value={count} />}
              {badge && <span className="ds-head-badge">{badge}</span>}
            </>
          )}
        </div>
        {centre ? (
          <div className="ds-head-middle">
            {headingTag}
            {subtitle && <span className="ds-head-line">{subtitle}</span>}
          </div>
        ) : (
          center &&
          (form ? (
            <form action={form} method="get" role="search" className="ds-head-center" {...formAttrs} onInput={type}>
              {center}
            </form>
          ) : (
            <div className="ds-head-center">{center}</div>
          ))
        )}
        <div className="ds-head-action">{action}</div>
      </div>
    </header>
  );
}

// Ds::Head::Title: the head's title, renamed in place, the text until it is clicked, then a field of the same size.
// Enter sends the new title to `rename`, Escape puts the old one back; without `rename` the title is plain text.
export type HeadTitleProps = {
  title: string;
  rename?: (title: string) => void;
  // The name of the field that carries the new title.
  field?: string;
  maxlength?: number;
  heading?: ElementType;
} & Omit<HTMLAttributes<HTMLDivElement>, "title">;

export function HeadTitle({ title, rename, field = "title", maxlength = 80, heading: Heading = "h1", className, ...rest }: HeadTitleProps) {
  const [editing, setEditing] = useState(false);
  const text = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    input.current?.focus();
    input.current?.select();
  }, [editing]);

  const cancel = () => {
    if (input.current) input.current.value = input.current.defaultValue;
    setEditing(false);
    requestAnimationFrame(() => text.current?.focus());
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = input.current?.value ?? "";
    setEditing(false);
    rename?.(value);
  };

  return (
    <div className={cx("ds-head-name", className)} {...rest}>
      <Heading className="ds-head-title" title={title}>
        {rename ? (
          <button ref={text} type="button" className="ds-head-rename" aria-label={`Rename ${title}`} hidden={editing} onClick={() => setEditing(true)}>
            {title}
          </button>
        ) : (
          title
        )}
      </Heading>
      {rename && (
        <form className="ds-head-form" hidden={!editing} onSubmit={submit}>
          <input
            key={title}
            ref={input}
            type="text"
            name={field}
            defaultValue={title}
            className="ds-head-input"
            required
            autoComplete="off"
            maxLength={maxlength}
            aria-label="Title"
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => event.key === "Escape" && cancel()}
          />
        </form>
      )}
    </div>
  );
}
