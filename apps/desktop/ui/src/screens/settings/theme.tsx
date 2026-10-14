import { Dialog } from "../../heads";
import { Slider } from "../../inputs";
import { Button, Field, Segments, Tag } from "../../primitives";

// Light, dark, or the system's.
export type Mode = "light" | "dark" | "system";
export const modes: readonly Mode[] = ["light", "dark", "system"];
const modeNames: Record<Mode, string> = { light: "Light", dark: "Dark", system: "System" };

// The greys' colour: where they sit on the colour wheel (0 to 360) and how far off grey (0 is grey, 3 is vivid); and the mode.
export type Theme = { hue: number; tint: number; mode: Mode };

export const themeRange = { hue: { min: 0, max: 360, step: 1 }, tint: { min: 0, max: 3, step: 0.05 } } as const;

export const themePresets: readonly (Omit<Theme, "mode"> & { name: string })[] = [
  { name: "Zinc", hue: 286, tint: 0.6 },
  { name: "Stone", hue: 70, tint: 0.6 },
  { name: "Slate", hue: 265, tint: 0.5 },
  { name: "Olive", hue: 107, tint: 1 },
  { name: "Clay", hue: 40, tint: 1.4 },
  { name: "Forest", hue: 150, tint: 1.4 },
  { name: "Plum", hue: 320, tint: 1.4 },
  { name: "Pure", hue: 265, tint: 0 },
];

export const defaultTheme: Theme = { hue: 286, tint: 0.6, mode: "system" };

export type ThemeDialogProps = {
  theme: Theme;
  change?: (theme: Theme) => void;
  reset?: () => void;
  close?: () => void;
};

// The account menu's Theme: the mode, a preset or the two sliders. The window takes each change at once; red, green, blue and
// amber keep their colours.
export function ThemeDialog({ theme, change = () => {}, reset = () => {}, close = () => {} }: ThemeDialogProps) {
  const same = (t: Omit<Theme, "mode">) => Math.abs(t.hue - theme.hue) < 0.5 && Math.abs(t.tint - theme.tint) < 0.03;
  return (
    <Dialog
      title="Theme"
      line={{ sub: "Light or dark, and the colour of the greys. Red, green, blue and amber stay as they are." }}
      glyph="theme"
      close={close}
      footer={
        <>
          <Button kind="ghost" size="small" hang onClick={reset}>
            Reset
          </Button>
          <Button kind="primary" size="small" onClick={close}>
            Done
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-stretch gap-5">
        <Field label="Mode">
          <Segments items={modes.map((m) => modeNames[m])} selection={modes.indexOf(theme.mode)} onChange={(i) => change({ ...theme, mode: modes[i] })} />
        </Field>
        <div className="flex flex-wrap gap-2">
          {themePresets.map((p) => (
            <Tag key={p.name} text={p.name} kind={same(p) ? "inverse" : "neutral"} onClick={() => change({ ...theme, hue: p.hue, tint: p.tint })} />
          ))}
        </div>
        <Slider label="Hue" spectrum value={theme.hue} {...themeRange.hue} onChange={(hue) => change({ ...theme, hue })} />
        <Slider label="Tint" value={theme.tint} {...themeRange.tint} display={theme.tint.toFixed(2)} onChange={(tint) => change({ ...theme, tint })} />
      </div>
    </Dialog>
  );
}
