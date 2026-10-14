import type { FormHTMLAttributes, HTMLAttributes, InputHTMLAttributes } from "react";
import { Button, type ButtonProps } from "./button";
import { cx } from "./cx";

// Ds::Address: a browser's address bar over a frame: home, back, forward and reload, the URL one can edit and go to,
// and copy. It draws; the page that owns the frame steers it, through `parts`.
export type AddressParts = {
  home?: Partial<ButtonProps>;
  back?: Partial<ButtonProps>;
  forward?: Partial<ButtonProps>;
  reload?: Partial<ButtonProps>;
  form?: FormHTMLAttributes<HTMLFormElement>;
  url?: InputHTMLAttributes<HTMLInputElement>;
  go?: Partial<ButtonProps>;
  copy?: Partial<ButtonProps>;
};

export type AddressProps = { url: string; parts?: AddressParts } & HTMLAttributes<HTMLDivElement>;

export function Address({ url, parts = {}, className, ...rest }: AddressProps) {
  const button = (name: "home" | "back" | "forward" | "reload" | "copy", glyph: string, label: string, disabled = false) => (
    <Button variant="ghost" size="sm" glyph={glyph} label={label} disabled={disabled} title={label} {...parts[name]} />
  );
  const input = parts.url ?? {};
  const value = "value" in input ? {} : { defaultValue: url };
  return (
    <div className={cx("ds-address", className)} {...rest}>
      {button("home", "home", "The app's front page")}
      {button("back", "chevron-left", "Back", true)}
      {button("forward", "chevron-right", "Forward", true)}
      {button("reload", "restore", "Reload")}
      <form className="ds-address-field" {...parts.form}>
        <input type="text" {...value} className="ds-address-url" aria-label="Address" spellCheck={false} autoComplete="off" {...input} />
        <Button variant="ghost" size="sm" type="submit" title="Go to this address" {...parts.go}>
          Go
        </Button>
      </form>
      {button("copy", "copy", "Copy path")}
    </div>
  );
}
