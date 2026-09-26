import type { CSSProperties, HTMLAttributes, IframeHTMLAttributes, ReactNode, Ref } from "react";
import { cx } from "./cx";

// Ds::Frame: a page that runs inside the app, an iframe in an edge on white, always sandboxed. A `bar` (usually
// Address) sits above it.
export type FrameProps = {
  src: string;
  title: string;
  sandbox?: string;
  height?: number;
  bar?: ReactNode;
  // Attributes for the frame itself, around the bar and the iframe.
  root?: HTMLAttributes<HTMLDivElement>;
  ref?: Ref<HTMLIFrameElement>;
} & Omit<IframeHTMLAttributes<HTMLIFrameElement>, "src" | "title" | "sandbox" | "height">;

export function Frame({ src, title, sandbox = "allow-scripts allow-forms", height, bar, root = {}, className, ...rest }: FrameProps) {
  const { className: rootClass, style: rootStyle, ...rootRest } = root;
  const style = height ? ({ "--height": `${height}px`, ...rootStyle } as CSSProperties) : rootStyle;
  return (
    <div className={cx("ds-frame", className, rootClass, { "has-height": height, "has-bar": bar })} style={style} {...rootRest}>
      {bar}
      <iframe src={src} title={title} sandbox={sandbox} loading="lazy" className="ds-frame-page" {...rest} />
    </div>
  );
}
