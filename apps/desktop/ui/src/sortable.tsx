// One way to reorder a list or a strip: drag an item (or its handle) past 4 points, or focus it and press Space, move
// with the arrow keys, press Space to drop, Escape to cancel. The others step aside as it moves; a screen reader hears
// each step. The only call out is `onReorder(from, to)`, once, when an item is dropped in another place.
import { createContext, useContext, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import {
  closestCenter, defaultDropAnimationSideEffects, DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type Announcements, type DragEndEvent, type DragStartEvent, type DropAnimation, type KeyboardCodes, type KeyboardCoordinateGetter, type Modifier,
} from "@dnd-kit/core";
import { horizontalListSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { createPortal } from "react-dom";
import { cn } from "./cn";

// How far a press moves before it is a drag; less is a click. The tab strip's own drag uses it too.
export const dragDistance = 4;
// How long the others take to step aside, and a dropped item to fly to its place.
const stepTime = 150;
const settleTime = 200;
// --ease-enter, spelled out: the Web Animations API that lands a drop cannot read a CSS variable.
const easeOut = "cubic-bezier(0.23, 1, 0.32, 1)";

// The drags of `Sortable` and the `Board`: past `dragDistance` with the pointer, or Space on the focused item, the arrow
// keys and Space or Enter to drop. `keys` replaces the keys that lift and drop (a board card keeps Enter to open);
// `steps` where an arrow key takes the held item.
export function useDragSensors(keys?: KeyboardCodes, steps: KeyboardCoordinateGetter = sortableKeyboardCoordinates) {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: dragDistance } }),
    useSensor(KeyboardSensor, { coordinateGetter: steps, keyboardCodes: keys }),
  );
}

// Whether a drag moves without motion: the person asked for reduced motion, or it was lifted with a key (keyboard
// actions repeat, so they jump).
export function dragStill(activator: Event | null) {
  const quiet = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  return quiet || (typeof KeyboardEvent !== "undefined" && activator instanceof KeyboardEvent);
}

// How the others step aside, for `useSortable`'s `transition`.
export const stepAside = (still: boolean) => (still ? null : { duration: stepTime, easing: easeOut });

// The drop: the held face flies to its place with an ease-out and puts its lift down on the way; its place stays hidden
// until it lands.
const settle: DropAnimation = {
  duration: settleTime,
  easing: easeOut,
  sideEffects: (parts) => {
    parts.dragOverlay.node.setAttribute("data-settling", "");
    return defaultDropAnimationSideEffects({ styles: { active: { opacity: "0" } } })(parts);
  },
};

// What follows the pointer while an item is held: the item lifted, a little larger over a deeper shadow. It follows at
// once (no transition on the move), lifts on the way in and lands on a drop; still, it does neither. `className` gives
// the face its radius. It is placed on the page's body, so a transformed parent cannot shift it.
// `lifted`: on white, with a shadow and a slight scale, as a card leaves its lane. Without, the overlay is drawn as it is
// (a table row's hover fill).
export function DragLayer({ still, lifted = true, className, children }: { still: boolean; lifted?: boolean; className?: string; children?: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <DragOverlay dropAnimation={still ? null : settle} transition={() => undefined}>
      {children && (
        <div
          className={cn(
            "cursor-grabbing",
            lifted && "bg-page shadow-menu scale-[1.02] in-data-settling:scale-100 in-data-settling:shadow-card",
            lifted && !still && "transition-[scale,box-shadow] duration-150 ease-out starting:scale-100 starting:shadow-card",
            className,
          )}
        >
          {children}
        </div>
      )}
    </DragOverlay>,
    document.body,
  );
}

export type SortableProps = {
  // The items' ids, in their order: each `SortableItem` inside carries one.
  ids: string[];
  axis?: "x" | "y";
  // The item at `from` now stands at `to`, both offsets into `ids`.
  onReorder: (from: number, to: number) => void;
  // What follows the pointer while an item is held; the item stays in its place as a grey. Without it the item itself
  // follows.
  overlay?: (id: string) => ReactNode;
  // The name a screen reader says for an id.
  label?: (id: string) => string;
  children?: ReactNode;
  // Whether what follows the pointer is lifted (white, a shadow): on by default; a table row drags as its hover fill.
  lifted?: boolean;
};

const strategies = { x: horizontalListSortingStrategy, y: verticalListSortingStrategy };

// An item moves along the axis only.
const along = (axis: "x" | "y"): Modifier => ({ transform }) => (axis === "x" ? { ...transform, y: 0 } : { ...transform, x: 0 });

export function Sortable({ ids, axis = "y", onReorder, overlay, label = (id) => id, lifted = true, children }: SortableProps) {
  const [held, setHeld] = useState<string | null>(null);
  const [still, setStill] = useState(false);
  const sensors = useDragSensors();
  const place = (id: string | number) => `Position ${ids.indexOf(String(id)) + 1} of ${ids.length}.`;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${label(String(active.id))}. ${place(active.id)}`,
    onDragOver: ({ active, over }) => (over ? `${label(String(active.id))} is over ${label(String(over.id))}. ${place(over.id)}` : undefined),
    onDragEnd: ({ active, over }) => `Dropped ${label(String(active.id))}. ${place(over?.id ?? active.id)}`,
    onDragCancel: ({ active }) => `Cancelled. ${label(String(active.id))} is back. ${place(active.id)}`,
  };
  const end = ({ active, over }: DragEndEvent) => {
    setHeld(null);
    if (!over) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from >= 0 && to >= 0 && from !== to) onReorder(from, to);
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[along(axis)]}
      accessibility={{ announcements, screenReaderInstructions: { draggable: "Press Space to lift, the arrow keys to move, Space to drop, Escape to cancel." } }}
      onDragStart={({ active, activatorEvent }: DragStartEvent) => {
        setHeld(String(active.id));
        setStill(dragStill(activatorEvent));
      }}
      onDragEnd={end}
      onDragCancel={() => setHeld(null)}
    >
      <Still.Provider value={still}>
        <SortableContext items={ids} strategy={strategies[axis]}>
          {children}
        </SortableContext>
      </Still.Provider>
      {overlay && (
        <DragLayer still={still} lifted={lifted} className="rounded-block">
          {held && overlay(held)}
        </DragLayer>
      )}
    </DndContext>
  );
}

const Still = createContext(false);

type Grip = { ref: (el: HTMLElement | null) => void; props: HTMLAttributes<HTMLElement>; dragging: boolean };
const GripContext = createContext<Grip | null>(null);

export type SortableState = { dragging: boolean };

// One item of a `Sortable`. With `handle`, only a `SortHandle` inside takes the drag and the key presses; without, the
// whole item does and takes the focus.
export function SortableItem({ id, handle, className, style, children }: {
  id: string;
  handle?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode | ((state: SortableState) => ReactNode);
}) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id, transition: stepAside(useContext(Still)) });
  const grip = { props: { ...attributes, ...listeners } as HTMLAttributes<HTMLElement>, ref: setActivatorNodeRef, dragging: isDragging };
  return (
    <GripContext.Provider value={grip}>
      <div
        ref={setNodeRef}
        {...(handle ? {} : grip.props)}
        className={cn(!handle && (isDragging ? "cursor-grabbing" : "cursor-grab"), isDragging && "opacity-40", className)}
        style={{ ...style, transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, transition, zIndex: isDragging ? 1 : undefined }}
      >
        {typeof children === "function" ? children({ dragging: isDragging }) : children}
      </div>
    </GripContext.Provider>
  );
}

// What takes the drag and the keys of a `SortableItem` that has a `handle`; it names the item for a screen reader.
export function SortHandle({ label, className, style, ...rest }: { label: string } & Omit<HTMLAttributes<HTMLSpanElement>, "role" | "aria-label">) {
  const grip = useContext(GripContext);
  if (!grip) return null;
  const { onKeyDown, onPointerDown, ...props } = grip.props as HTMLAttributes<HTMLSpanElement>;
  return (
    <span
      ref={grip.ref}
      {...props}
      {...rest}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        rest.onKeyDown?.(e);
      }}
      onPointerDown={(e) => {
        onPointerDown?.(e);
        rest.onPointerDown?.(e);
      }}
      title="Drag to reorder"
      aria-label={label}
      data-testid={`sort:${label}`}
      className={cn(grip.dragging ? "cursor-grabbing" : "cursor-grab", className)}
      style={style}
    />
  );
}
