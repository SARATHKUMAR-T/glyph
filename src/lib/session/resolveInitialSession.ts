import { invoke } from "@tauri-apps/api/core";

import { createTab } from "../terminal/createTab";
import { createId, getAllPanesInTree } from "../terminal/splitTree";
import type { TerminalTabModel } from "../terminal/types";
import { isTauriRuntime } from "../terminal/events";
import { readStoredSettings } from "../../hooks/useTerminalSettings";
import { workspaceLayoutToSplitNode } from "../workspace/treeConverter";
import type { Session } from "../workspace/types";

export type InitialSession = {
  tabs: TerminalTabModel[];
  activeTabId: string;
  nextTabIndex: number;
};

function blankSession(): InitialSession {
  const tab = createTab(1);
  return { tabs: [tab], activeTabId: tab.clientId, nextTabIndex: 2 };
}

/** Runs once, before the component tree mounts (see `main.tsx`), to decide
 * what the first frame should show: either a restored session's tabs, or a
 * single blank one. This has to happen before `<App>` renders at all,
 * rather than in an effect after an initial blank tab — a pane's
 * `GlyphEngineTerminalView` spawns a real PTY session as soon as it mounts,
 * and unmounting it again does not close that session (see its cleanup
 * function's doc comment), so mounting a throwaway default tab first and
 * replacing it once this resolves would leak an orphaned shell process for
 * the rest of the app's lifetime. */
export async function resolveInitialSession(): Promise<InitialSession> {
  if (!isTauriRuntime()) {
    return blankSession();
  }
  const restoreAllTabs = readStoredSettings().restoreTabsOnRestart;

  let session: Session | null = null;
  try {
    session = await invoke<Session | null>("load_session");
  } catch (err: unknown) {
    console.error("[resolveInitialSession] load_session failed:", err);
  }

  // With "Restore Tabs on Restart" off, only tabs from "Preserve Panes"
  // workspaces come back (a session saved while the setting was still on
  // can hold others).
  const sessionTabs = session?.tabs.filter((tab) => restoreAllTabs || tab.preservePanes) ?? [];
  if (!session || sessionTabs.length === 0) {
    return blankSession();
  }
  const activeSessionTab = session.tabs[session.activeTabIndex];

  const tabs: TerminalTabModel[] = sessionTabs.map((sessionTab) => {
    const { rootNode } = workspaceLayoutToSplitNode(sessionTab.layout, sessionTab.panes);
    const panes = getAllPanesInTree(rootNode);
    return {
      clientId: createId(),
      title: sessionTab.title || "Terminal",
      rootNode,
      activePaneId: panes[0]?.paneId || createId(),
      preservePanes: sessionTab.preservePanes ?? false,
      workspaceId: sessionTab.workspaceId ?? undefined,
    };
  });

  const activeIndex = Math.max(0, sessionTabs.indexOf(activeSessionTab));

  return {
    tabs,
    activeTabId: tabs[activeIndex].clientId,
    nextTabIndex: tabs.length + 1,
  };
}
