import { useId, type ChangeEvent, type CSSProperties, type ComponentProps, type FieldsetHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";
import { Icon } from "./icon";

export type ChoiceItem = {
  value: string;
  name: ReactNode;
  details?: ReactNode | ReactNode[];
  icon?: ComponentProps<typeof Icon>["name"];
  disabled?: boolean;
};

// Ds::Choice: options as cards, one chosen, radio inputs drawn as square cards with an icon, a name and details.
// With `submit` a pick sends the form, for a choice that reshapes the rest of the page.
export type ChoiceProps = {
  name: string;
  items: ChoiceItem[];
  value?: string;
  label?: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  columns?: number;
  submit?: boolean;
  disabled?: boolean;
  id?: string;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
} & Omit<FieldsetHTMLAttributes<HTMLFieldSetElement>, "children" | "onChange">;

export function Choice({
  name,
  items,
  value,
  label,
  help,
  error,
  columns = 2,
  submit = false,
  disabled = false,
  id,
  onChange,
  className,
  style,
  ...rest
}: ChoiceProps) {
  const auto = `choice-${useId().replace(/:/g, "")}`;
  const key = id ?? auto;
  const invalid = error != null && error !== false && error !== "";
  const message = invalid ? error : help;
  const messageId = `${key}-message`;
  const off = (item: ChoiceItem) => disabled || item.disabled;

  const change = (event: ChangeEvent<HTMLInputElement>) => {
    onChange?.(event);
    if (submit) event.currentTarget.form?.requestSubmit();
  };

  return (
    <fieldset
      className={cx("ds-choice", className, { "is-error": invalid, "is-disabled": disabled })}
      style={{ "--columns": columns, ...style } as CSSProperties}
      disabled={disabled || undefined}
      aria-describedby={message ? messageId : undefined}
      {...rest}
    >
      {label && <legend className="ds-choice-label">{label}</legend>}
      <div className="ds-choice-cards">
        {items.map((item) => (
          <label key={item.value} className={cx("ds-choice-card", { "is-disabled": off(item) })}>
            <input
              type="radio"
              className="ds-choice-input"
              name={name}
              value={item.value}
              {...(onChange ? { checked: String(item.value) === String(value) } : { defaultChecked: String(item.value) === String(value) })}
              disabled={off(item) || undefined}
              onChange={change}
            />
            {item.icon && <Icon name={item.icon} size={28} family={off(item) ? "off" : undefined} />}
            <span className="ds-choice-text">
              <span className="ds-choice-name">{item.name}</span>
              {(Array.isArray(item.details) ? item.details : item.details != null ? [item.details] : []).map((line, i) => (
                <span key={i} className="ds-choice-details">
                  {line}
                </span>
              ))}
            </span>
          </label>
        ))}
      </div>
      {message && (
        <p className={invalid ? "ds-choice-error" : "ds-choice-help"} id={messageId}>
          {message}
        </p>
      )}
    </fieldset>
  );
}
