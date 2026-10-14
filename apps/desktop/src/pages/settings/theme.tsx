import { ThemeDialog } from "@hz/ui";
import { themeStore, useTheme } from "../../theme";

// The account menu's Theme: the dialog over the window, each change applied and saved at once.
export function ThemePage({ close }: { close: () => void }) {
  const theme = useTheme();
  return <ThemeDialog theme={theme} change={themeStore.set} reset={themeStore.reset} close={close} />;
}
