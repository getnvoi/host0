import { Children, createContext, useContext, useId, useState, type ReactNode } from "react";
import { Accordion } from "./accordion";
import { Clickable } from "./clickable";
import { Glyph, Turn } from "./glyph";
import { Button, GroupTitle, IconButton, Item, itemSize, Pill, Rule, SwitchMark, type ItemLine, type Lead } from "./primitives";
import { SortHandle, Sortable, SortableItem } from "./sortable";
import { palette } from "./tokens";

// The end of a full-page form: what is done to the record as a whole (archive, delete), centred under the sections.
// A delete is a red tinted button.
export function FormFoot({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-center gap-2 pt-4">{children}</div>;
}

// A section of a full-page form: its title and what it is for, then its fields.
export function FormSection({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className="flex w-full flex-col items-stretch gap-5">
      <Item title={title} line={{ sub: text }} wrap />
      {children}
    </div>
  );
}

// Fields side by side in equal columns, aligned to the top, so a help or error line never moves the field beside
// it. `half` keeps a single field to half the row.
export function FieldRow({ half, children }: { half?: boolean; children: ReactNode }) {
  if (half) {
    // Two flexible halves: the field, and the space where a second field would sit.
    return (
      <div className="grid w-full grid-cols-2 items-start gap-4">
        <div className="flex min-w-0 flex-col">{children}</div>
      </div>
    );
  }
  return (
    <div className="grid w-full auto-cols-fr grid-flow-col items-start gap-4">
      {Children.map(children, (child) => (
        <div className="flex min-w-0 flex-col">{child}</div>
      ))}
    </div>
  );
}

// A list of repeated blocks (steps, commands): each block between lines, the add button below the last.
export function FormSteps({ add, onAdd, children }: { add: string; onAdd?: () => void; children?: ReactNode }) {
  return (
    <div className="flex w-full flex-col items-start gap-4">
      <div className="flex w-full flex-col">
        {children}
        <Rule />
      </div>
      <Button size="small" glyph="plus" onClick={onAdd}>
        {add}
      </Button>
    </div>
  );
}

// A step's place in a sortable FormList.
type SortSlot = { id: string };
const SortSlotContext = createContext<SortSlot | null>(null);

export type FormStepProps = {
  title: string;
  line?: ItemLine;
  lead: Lead;
  remove?: () => void;
  children?: ReactNode;
};

// One block of a `FormSteps`: a lead (number or icon), its title and line, Remove on the right, then its fields.
export function FormStep(props: FormStepProps) {
  const slot = useContext(SortSlotContext);
  return slot ? <SortableStep {...props} slot={slot} /> : <StepBody {...props} />;
}

// In a sortable list the lead is the handle: the grip on hover or focus, the open hand; the steps step aside as one is
// moved.
function SortableStep({ slot, ...props }: FormStepProps & { slot: SortSlot }) {
  const [hover, setHover] = useState(false);
  const m = itemSize.medium;
  return (
    <SortableItem id={slot.id} handle>
      {({ dragging }) => (
        <StepBody
          {...props}
          lead={hover || dragging ? { visual: "grip" } : props.lead}
          handle={
            <SortHandle
              label={`Move ${props.title}`}
              onMouseEnter={() => setHover(true)}
              onMouseLeave={() => setHover(false)}
              onFocus={() => setHover(true)}
              onBlur={() => setHover(false)}
              className="absolute top-1/2 left-0 -translate-y-1/2"
              style={{ width: m.lead, height: m.lead }}
            />
          }
        />
      )}
    </SortableItem>
  );
}

function StepBody({ title, line, lead, remove, children, handle }: FormStepProps & { handle?: ReactNode }) {
  return (
    <div className="relative flex w-full flex-col items-stretch gap-4 py-6">
      <Rule className="absolute inset-x-0 top-0" />
      <div className="relative flex w-full">
        <Item title={title} line={line} lead={lead} trailing={<IconButton glyph="trash" label={`Remove ${title}`} onClick={remove} />} />
        {handle}
      </div>
      {children}
    </div>
  );
}

export type FormListProps<T> = {
  data: T[];
  id: (item: T) => string | number;
  add: string;
  onAdd?: () => void;
  // Moves the row at `from` to `to`, both offsets into `data`.
  onSort?: (from: number, to: number) => void;
  row: (item: T, index: number) => ReactNode;
};

// A form's repeated blocks over data: each row a FormStep, the add button below the last. With `onSort`, a row is
// dragged by its lead, or moved with the keys, and dropped in another place.
export function FormList<T>({ data, id, add, onAdd, onSort, row }: FormListProps<T>) {
  const list = useId();
  const ids = data.map((item) => `${list}:${id(item)}`);
  const rows = data.map((item, n) => (
    <SortSlotContext.Provider key={ids[n]} value={onSort ? { id: ids[n] } : null}>
      {row(item, n)}
    </SortSlotContext.Provider>
  ));
  if (!onSort) return <FormSteps add={add} onAdd={onAdd}>{rows}</FormSteps>;
  // The step held follows the pointer as a plain step, not a place in the list.
  const held = (key: string) => (
    <SortSlotContext.Provider value={null}>{row(data[ids.indexOf(key)], ids.indexOf(key))}</SortSlotContext.Provider>
  );
  return (
    <Sortable ids={ids} onReorder={onSort} overlay={held} label={(key) => `step ${ids.indexOf(key) + 1}`}>
      <FormSteps add={add} onAdd={onAdd}>
        {rows}
      </FormSteps>
    </Sortable>
  );
}

// A group title that folds what follows: a chevron, the title and, folded, a summary of the values inside. What it folds
// is its children, in an `Accordion`.
export function Disclosure({ title, summary, open, onChange, children }: { title: string; summary?: string; open: boolean; onChange?: (open: boolean) => void; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-stretch">
      <Clickable
        bleed={8}
        onClick={() => onChange?.(!open)}
        label={open ? `Hide ${title}` : `Show ${title}`}
        aria-expanded={open}
        className="-my-1.5 flex w-full items-center gap-2 py-1.5"
      >
        <Turn open={open}>
          <Glyph name="chevronRight" size={10} color={palette.tertiary} width={1.8} />
        </Turn>
        <GroupTitle title={title} />
        {!open && summary && <span className="truncate text-[13px] text-tertiary">{summary}</span>}
      </Clickable>
      {children !== undefined && (
        // The padding keeps a field's focus ring inside the clip; the margin takes it back.
        <Accordion open={open} className="-m-1 p-1">
          <div className="pt-3.5">{children}</div>
        </Accordion>
      )}
    </div>
  );
}

// A switch leading an item: the whole row is clickable. The switch sits on the section's left edge.
export function ToggleRow({
  title, line, monoSub, on, onChange, disabled,
}: { title: string; line?: ItemLine; monoSub?: boolean; on: boolean; onChange?: (on: boolean) => void; disabled?: boolean }) {
  return (
    <Clickable
      bleed={8}
      disabled={disabled}
      onClick={() => onChange?.(!on)}
      label={title}
      handle={`toggle:${title}`}
      chosen={on}
      aria-checked={on}
      className="flex h-10 w-full items-center gap-3"
    >
      <SwitchMark on={on} />
      <Item title={title} line={line} size="small" monoSub={monoSub} />
    </Clickable>
  );
}

// A full-page form's head actions: unsaved changes, Cancel and the save; an archived record offers Restore instead.
export function FormActions({
  save = "Save", dirty, archived, saving, cancel, onSave, restore,
}: { save?: string; dirty?: boolean; archived?: boolean; saving?: boolean; cancel?: () => void; onSave?: () => void; restore?: () => void }) {
  if (archived) {
    return (
      <div className="flex items-center gap-2">
        <Button kind="primary" size="small" glyph="restore" loading={saving} onClick={restore}>
          Restore
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {dirty && (
        <span className="mr-1 flex">
          <Pill text="Unsaved changes" tone="orange" />
        </span>
      )}
      <Button size="small" onClick={cancel}>
        Cancel
      </Button>
      <Button kind="primary" size="small" loading={saving} onClick={onSave}>
        {save}
      </Button>
    </div>
  );
}
