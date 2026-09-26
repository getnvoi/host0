import { useId, useRef, type DialogHTMLAttributes, type ReactNode } from "react";
import { Button } from "./button";
import { cx } from "./cx";
import { useModal } from "./dialog";

// Ds::Lightbox: one picture, large, over the washed page: its title and caption above, the picture on a dark ground,
// its place in the set with previous and next below. The same native modal as the dialog, with the same close rules.
// The owner fills and walks it through its props; without onPrevious and onNext the steps are off.
export type LightboxProps = {
  id?: string;
  title?: string;
  caption?: ReactNode;
  src?: string;
  // Where this picture sits in the set, as words: "2 / 5".
  position?: ReactNode;
  open?: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
  onClose?: () => void;
} & Omit<DialogHTMLAttributes<HTMLDialogElement>, "id" | "title" | "open" | "onClose">;

export function Lightbox({ id, title = "", caption, src, position, open = false, onPrevious, onNext, onClose, className, ...rest }: LightboxProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const modal = useModal(ref, open);
  const auto = useId();
  const titleId = `${id ?? auto}-title`;
  return (
    <dialog
      ref={ref}
      id={id}
      className={cx("ds-lightbox", className)}
      aria-labelledby={titleId}
      onPointerDown={modal.onPointerDown}
      onClick={modal.onClick}
      onClose={onClose}
      {...rest}
    >
      <div className="ds-lightbox-head">
        <div className="ds-lightbox-words">
          <div className="ds-lightbox-title" id={titleId} role="heading" aria-level={2}>
            {title}
          </div>
          <div className="ds-lightbox-caption">{caption}</div>
        </div>
        <Button size="sm" glyph="close" label="Close" onClick={modal.close} />
      </div>
      <div className="ds-lightbox-ground">
        <img src={src} alt={title} className="ds-lightbox-image" />
      </div>
      <div className="ds-lightbox-foot">
        <span className="ds-lightbox-position">{position}</span>
        <span className="ds-lightbox-steps">
          <Button size="sm" glyph="chevron-left" label="Previous" disabled={!onPrevious} onClick={onPrevious} />
          <Button size="sm" glyph="chevron-right" label="Next" disabled={!onNext} onClick={onNext} />
        </span>
      </div>
    </dialog>
  );
}
