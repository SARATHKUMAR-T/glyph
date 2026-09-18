import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "../lib/terminal/events";
import { splitNodeToWorkspaceLayout } from "../lib/workspace/treeConverter";
import type { Session, SessionTab } from "../lib/workspace/types";
import type { SplitNode, TerminalTabModel } from "../lib/terminal/types";
import { getTerminalCwd } from "./useTerminalSession";

const DEBOUNCE_MS = 1000;

function collectPaneSessionIds(node: SplitNode, out: Map<string, string>) {
  if (node.type === "pane") {
    if (node.pane.sessionId) out.set(node.pane.paneId, node.pane.sessionId);
  } else {
    collectPaneSessionIds(node.children[0], out);
    collectPaneSessionIds(node.children[1], out);
  }
}

async function buildSessionTab(tab: TerminalTabModel): Promise<SessionTab> {
  const { layout, panes } = splitNodeToWorkspaceLayout(tab.rootNode);
  const sessionIds = new Map<string, string>();
  collectPaneSessionIds(tab.rootNode, sessionIds);

  const panesWithLiveCwd = await Promise.all(
    panes.map(async (pane) => {
      const sessionId = sessionIds.get(pane.id);
      if (!sessionId) return pane;
      const liveCwd = await getTerminalCwd(sessionId);
      return liveCwd ? { ...pane, cwd: liveCwd } : pane;
    }),
  );

  return { title: tab.title, layout, panes: panesWithLiveCwd };
}

/** Auto-saves the full open-tab state (debounced) on every structural
 * change, so `resolveInitialSession` has something to restore after a
 * crash or restart. Deliberately keyed on `tabs`/`activeTabId` only — those
 * change on tab/pane add/remove/split/title updates, not on every
 * keystroke (terminal byte output never touches this React state, see
 * `GlyphEngineTerminalView`), so this doesn't fire anywhere near as often
 * as it might look. */
export function useSessionPersistence(tabs: TerminalTabModel[], activeTabId: string, enabled: boolean) {
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!enabled || !isTauriRuntime()) return;

    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      void (async () => {
        const sessionTabs = await Promise.all(tabs.map(buildSessionTab));
        const activeTabIndex = Math.max(
          0,
          tabs.findIndex((tab) => tab.clientId === activeTabId),
        );
        const session: Session = {
          tabs: sessionTabs,
          activeTabIndex,
          savedAt: Date.now(),
        };
        try {
          await invoke("save_session", { session });
        } catch (err: unknown) {
          console.error("[useSessionPersistence] save_session failed:", err);
        }
      })();
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timerRef.current);
  }, [tabs, activeTabId, enabled]);
}
