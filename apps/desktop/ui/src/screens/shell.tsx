import { useContext, type ReactNode } from "react";
import { TabStrip } from "../chrome";
import { Surface } from "../surface";
import { ShowsTabStrip } from "./navigate";
import { paths, settingsPages } from "./routes";
import { samples } from "./samples";

export type SettingsShellProps = {
  // The settings page shown, by its menu title ("Members").
  active: string;
  // The path the tab shows when it is not the settings page itself (a form).
  tab?: string;
  // The tab's title when the path alone does not name it (a record's name).
  tabTitle?: string;
  // A page head over the scrolling content; omitted, `children` brings its own head and body (as ListPage does).
  head?: ReactNode;
  children: ReactNode;
  over?: ReactNode;
};

// The settings tab: the page head over the page.
export function SettingsShell({ active, tab, tabTitle, head, children, over }: SettingsShellProps) {
  const strip = useContext(ShowsTabStrip);
  const page = settingsPages.find(([, title]) => title === active);
  const shown = tab ?? (page ? paths.settings(page[0]) : undefined);
  return (
    <div className="relative flex h-full flex-col bg-page">
      {strip && <TabStrip tabs={samples.settingsTabs(shown, tabTitle)} active={3} />}
      {head === undefined ? (
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      ) : (
        <Surface preset="page" className="flex-1" header={head} inset="centered">
          {children}
        </Surface>
      )}
      {over}
    </div>
  );
}

