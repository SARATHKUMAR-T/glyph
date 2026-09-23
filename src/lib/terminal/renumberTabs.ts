import type { TerminalTabModel } from "./types";

/** Matches only titles this app auto-generated (`createTab`'s `Terminal
 * ${index}`, or the `handleSessionReady` fallback in App.tsx) — never a
 * user-visible custom title such as a restored workspace's name or a
 * shell-reported title, which must survive a close untouched. */
export const AUTO_TITLE_PATTERN = /^Terminal \d+$/;

/** After a tab closes, renumbers the remaining auto-titled tabs (skipping
 * any with a custom title) to `Terminal 1`, `Terminal 2`, ... in their
 * current order, so e.g. closing tabs 1–4 out of 5 leaves the survivor
 * "Terminal 5" renamed to "Terminal 1" instead of keeping a stale number. */
export function renumberAutoTitledTabs<T extends Pick<TerminalTabModel, "title">>(tabs: T[]): T[] {
  let counter = 0;
  return tabs.map((tab) => {
    if (!AUTO_TITLE_PATTERN.test(tab.title)) return tab;
    counter += 1;
    const title = `Terminal ${counter}`;
    return tab.title === title ? tab : { ...tab, title };
  });
}
