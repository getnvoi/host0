import { useId, useState, type ChangeEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

// Ds::Switch: on or off, applied at once, a checkbox with the switch role drawn as a round track and a knob.
// Attributes other than these options go on the checkbox.
export type SwitchProps = {
  name?: string;
  value?: string;
  uncheckedValue?: string;
  checked?: boolean;
  label?: ReactNode;
  description?: ReactNode;
  side?: "start" | "end";
  submit?: boolean;
  loading?: boolean;
  disabled?: boolean;
  id?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "checked">;

export function Switch({
  name,
  value = "1",
  uncheckedValue,
  checked = false,
  label,
  description,
  side = "start",
  submit = false,
  loading = false,
  disabled = false,
  id,
  onChange,
  ...attrs
}: SwitchProps) {
  const auto = `switch-${useId().replace(/:/g, "")}`;
  const key = id ?? auto;
  const descriptionId = `${key}-description`;
  // A flip is the save: the form goes at once and the switch holds still until the page answers.
  const [saving, setSaving] = useState(false);
  const busy = loading || saving;

  const change = (event: ChangeEvent<HTMLInputElement>) => {
    onChange?.(event);
    if (!submit) return;
    const form = event.currentTarget.form;
    if (!form) return;
    setSaving(true);
    form.requestSubmit();
  };

  return (
    <label className={cx("ds-switch", { "is-end": side === "end", "is-loading": busy, "is-disabled": disabled })}>
      {uncheckedValue && name && <input type="hidden" name={name} value={uncheckedValue} />}
      <input
        type="checkbox"
        role="switch"
        className="ds-switch-input"
        id={key}
        name={name}
        value={value}
        {...(onChange ? { checked } : { defaultChecked: checked })}
        disabled={disabled || loading || undefined}
        aria-busy={busy ? true : undefined}
        aria-describedby={description ? descriptionId : undefined}
        onChange={change}
        {...attrs}
      />
      <span className="ds-switch-track" aria-hidden="true">
        <span className="ds-switch-knob" />
      </span>
      {(label || description) && (
        <span className="ds-switch-text">
          {label && <span className="ds-switch-label">{label}</span>}
          {description && (
            <span className="ds-switch-description" id={descriptionId}>
              {description}
            </span>
          )}
        </span>
      )}
    </label>
  );
}
