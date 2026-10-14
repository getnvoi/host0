import { useState, type CSSProperties, type ReactNode } from "react";
import { Dropdown, menu, Tooltip, type MenuEntry } from "./menu";
import { Avatar, type Person } from "./primitives";

// How a stack answers the pointer (transitions.dev, avatar group hover): the hovered face lifts and grows a little, its
// neighbours lift less the further they are, and all settle back with a small spring when the pointer leaves.
const stackLift = -4;
const stackFalloff = 0.45;
const stackScale = 1.05;
const stackDuration = 300;
const stackLiftEase = "cubic-bezier(0.22, 1, 0.36, 1)";
const stackSettleEase = "cubic-bezier(0.34, 3.85, 0.64, 1)";

// Overlapping avatars; the last one sits on top. The ring takes the surface behind the stack. Past `limit`, the
// rest is one "+N" chip naming them on hover. Faces lift under the pointer (stackLift).
// `tooltips`: each face names its person in a tooltip. `card`: a click on a face opens a small card (the person, their
// detail, then the actions it returns); the "+N" chip opens a card listing the rest.
// The room a stack keeps around its faces for their ring; what lines a stack's first face up with others reads it.
export const stackRing = 2;

export function AvatarStack({ people, size = 24, ring, limit, tooltips, card }: { people: Person[]; size?: number; ring?: string; limit?: number; tooltips?: boolean; card?: (person: Person) => MenuEntry[] }) {
  const shown = limit !== undefined && people.length > limit ? people.slice(0, Math.max(limit - 1, 0)) : people;
  const rest = people.slice(shown.length);
  const ringColor = ring ?? "var(--ring, var(--color-page))";
  const ringStyle: CSSProperties = { boxShadow: `0 0 0 1px ${ringColor}, inset 0 0 0 1px ${ringColor}` };
  const [over, setOver] = useState<number>();
  const lift = (i: number): CSSProperties => {
    const d = over === undefined ? undefined : Math.abs(i - over);
    return {
      transform: d === undefined ? undefined : `translateY(${(stackLift * stackFalloff ** d).toFixed(2)}px) scale(${d === 0 ? stackScale : 1})`,
      transitionDuration: `${stackDuration}ms`,
      transitionTimingFunction: over === undefined ? stackSettleEase : stackLiftEase,
    };
  };
  const named = (p: Person) => p.name ?? p.initials;
  // A face, wrapped by the variant: a tooltip with the name, or a card opened by a click.
  const wrap = (face: ReactNode, title: string, entries: MenuEntry[] | undefined, i: number) => {
    if (entries) return <Dropdown key={i} entries={entries} width={240} fill="clear" handle={`avatar:${title}`} label={() => face} className="rounded-full" />;
    if (tooltips) return <Tooltip key={i} text={title}>{face}</Tooltip>;
    return face;
  };
  const cardOf = (p: Person): MenuEntry[] => [menu.header(named(p), p.detail ?? "", { avatar: p.initials, fill: p.fill, src: p.src }), ...(card ? card(p) : [])];
  return (
    <span className="inline-flex items-center [.clickable:hover_&]:[--ring:var(--fill,var(--click-fill))]" style={{ padding: stackRing }} onPointerLeave={() => setOver(undefined)}>
      {shown.map((p, i) =>
        wrap(
          <span
            key={i}
            title={tooltips || card ? undefined : named(p)}
            onPointerEnter={() => setOver(i)}
            className="relative rounded-full transition-transform motion-reduce:transition-none"
            style={{ marginLeft: i ? -4 : 0, zIndex: i, ...ringStyle, ...lift(i) }}
          >
            <Avatar initials={p.initials} size={size} fill={p.fill === "white" ? undefined : p.fill} fontSize={9} src={p.src} />
          </span>,
          named(p),
          card ? cardOf(p) : undefined,
          i,
        ),
      )}
      {rest.length > 0 &&
        wrap(
          <span
            key="rest"
            title={tooltips || card ? undefined : rest.map(named).join(", ")}
            onPointerEnter={() => setOver(shown.length)}
            className="relative inline-flex items-center justify-center rounded-full bg-area px-1 text-[9px] font-medium tabular-nums text-secondary transition-transform motion-reduce:transition-none"
            style={{ height: size, minWidth: size, marginLeft: shown.length ? -4 : 0, zIndex: shown.length, ...ringStyle, ...lift(shown.length) }}
          >
            +{rest.length}
          </span>,
          rest.map(named).join(", "),
          card ? rest.map((p) => menu.item(named(p), { detail: p.detail })) : undefined,
          shown.length,
        )}
    </span>
  );
}
