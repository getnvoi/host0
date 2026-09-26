import { useId, useRef, type CSSProperties, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cx } from "./cx";
import { Glyph } from "./glyph";

// Ds::Field: a labelled control, a text input, a textarea or a select, square on white with a g8 edge.
// Attributes other than className and style go on the control; those two go on the wrapper.
export type FieldProps = {
  name?: string;
  value?: string;
  as?: "text" | "textarea" | "select";
  type?: string;
  label?: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  placeholder?: string;
  required?: boolean;
  mono?: boolean;
  glyph?: string | null;
  // [label, value] pairs or plain values, as options_for_select takes them.
  items?: (string | [string, string])[];
  blank?: string;
  rows?: number;
  size?: "md" | "sm";
  disabled?: boolean;
  readonly?: boolean;
  id?: string;
  className?: string;
  style?: CSSProperties;
} & Omit<InputHTMLAttributes<HTMLInputElement> & TextareaHTMLAttributes<HTMLTextAreaElement> & SelectHTMLAttributes<HTMLSelectElement>, "size" | "value" | "children">;

export function Field({
  name,
  value,
  as = "text",
  type = "text",
  label,
  help,
  error,
  placeholder,
  required = false,
  mono = false,
  glyph,
  items = [],
  blank,
  rows = 4,
  size = "md",
  disabled = false,
  readonly = false,
  id,
  className,
  style,
  ...attrs
}: FieldProps) {
  const auto = `field-${useId().replace(/:/g, "")}`;
  const key = id ?? auto;
  const box = useRef<HTMLDivElement>(null);
  const search = as === "text" && type === "search";
  const select = as === "select";
  const mark = glyph === undefined ? (type === "search" ? "search" : null) : glyph;
  const invalid = error != null && error !== false && error !== "";
  const message = invalid ? error : help;
  const messageId = `${key}-message`;
  const common = {
    id: key,
    name,
    className: cx("ds-field-input", { "is-mono": mono }),
    required: required || undefined,
    disabled: disabled || undefined,
    readOnly: readonly && !select ? true : undefined,
    "aria-invalid": invalid ? true : undefined,
    "aria-describedby": message ? messageId : undefined,
    ...attrs,
  };

  // Clears a search field and tells its listeners, as typing would.
  const clear = () => {
    const input = box.current?.querySelector("input");
    if (!input) return;
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  };

  // A React caller that listens to changes holds the value; otherwise the control holds it, as a form field does.
  const bind = attrs.onChange ? { value: value ?? "" } : { defaultValue: value };
  let control;
  if (as === "textarea") control = <textarea {...bind} rows={rows} placeholder={placeholder} {...common} />;
  else if (select)
    control = (
      <select {...bind} {...common}>
        {blank != null && <option value="">{blank}</option>}
        {items.map((item) => {
          const [text, v] = Array.isArray(item) ? item : [item, item];
          return (
            <option key={v} value={v}>
              {text}
            </option>
          );
        })}
      </select>
    );
  else control = <input type={type} {...bind} placeholder={placeholder ?? (search ? "Search" : undefined)} {...common} />;

  const classes = cx("ds-field", `is-${size}`, className, {
    "has-glyph": mark && !select,
    "is-search": search,
    "is-error": invalid,
    "is-disabled": disabled,
    "is-readonly": readonly || attrs.readOnly,
  });

  return (
    <div className={classes} style={style}>
      {label && (
        <label className="ds-field-label" htmlFor={key}>
          {label}
          {required && (
            <span className="ds-field-required" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      <div className="ds-field-box" ref={box}>
        {mark && !select && <Glyph name={mark} size={14} className="ds-field-glyph" />}
        {control}
        {search && (
          <button type="button" className="ds-field-clear" aria-label="Clear" onClick={clear}>
            <Glyph name="close" size={12} />
          </button>
        )}
        {select && <Glyph name="chevron-down" size={14} className="ds-field-chevron" />}
      </div>
      {message && (
        <p className={invalid ? "ds-field-error" : "ds-field-help"} id={messageId}>
          {message}
        </p>
      )}
    </div>
  );
}
