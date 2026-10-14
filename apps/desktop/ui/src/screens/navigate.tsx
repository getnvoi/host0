import { createContext, useContext } from "react";

// How a path opens. From the commander: its tab if one shows it, else a new tab. From a link inside a page or the
// settings menu: in the current tab, which takes the path's title and content.
export type Opening = "tab" | "here";

export type Navigate = (path: string, opening?: Opening, title?: string) => void;

export const NavigateContext = createContext<Navigate>(() => {});

// What screens call to move: `navigate(paths.environment(id))` swaps the current tab; `navigate(path, "tab")` opens one.
export function useNavigate(): Navigate {
  return useContext(NavigateContext);
}

// False inside the app, whose window draws the tab strip once; screens then leave theirs out.
export const ShowsTabStrip = createContext(true);

