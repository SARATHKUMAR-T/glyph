import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

import { Settings } from "../components/settings/Settings";
import { TerminalSplitView } from "../components/terminal/TerminalSplitView";
import { TerminalTabs } from "../components/tabs/TerminalTabs";
import { TitleBar } from "../components/window/TitleBar";
import { WindowResizeHandles } from "../components/window/WindowResizeHandles";
import { MatrixDotBackground } from "../components/terminal/MatrixDotBackground";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useTerminalBlocks } from "../hooks/useTerminalBlocks";
import { useTerminalSettings } from "../hooks/useTerminalSettings";
import { useKeybindings } from "../hooks/useKeybindings";
import { isTauriRuntime } from "../lib/terminal/events";
import { getTerminalCwd } from "../hooks/useTerminalSession";
import {
  createId,
  createPaneNode,
  findPaneNode,
  getAllPanesInTree,
  removePaneFromTree,
  splitPaneInTree,
  updatePaneInTree,
  updateSplitRatioInTree,
} from "../lib/terminal/splitTree";
import type {
  SplitDirection,
  TerminalPaneModel,
  TerminalSemanticEvent,
  TerminalSessionInfo,
  TerminalStatus,
  TerminalTabModel,
} from "../lib/terminal/types";

function createTab(index: number, cwd?: string | null): TerminalTabModel {
  const rootNode = createPaneNode(cwd);
  const initialPane = (rootNode as { pane: TerminalPaneModel }).pane;
  return {
    clientId: createId(),
    title: `Terminal ${index}`,
    rootNode,
    activePaneId: initialPane.paneId,
  };
}

function formatTabTitle(index: number): string {
  return `Terminal ${index}`;
}

export function App() {
  const nextTabIndex = useRef(2);
  const [tabs, setTabs] = useState<TerminalTabModel[]>(() => [createTab(1)]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].clientId);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { blocksByTab, clearBlocks, ingestSemanticEvent } = useTerminalBlocks();
  const { settings, updateSettings } = useTerminalSettings();
  const { keybindings, updateKeybinding, resetKeybindings } = useKeybindings();

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.clientId === activeTabId) ?? tabs[0],
    [activeTabId, tabs],
  );

  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const addTerminal = useCallback(async () => {
    let inheritedCwd: string | undefined;
    const currentActiveTab = tabsRef.current.find((t) => t.clientId === activeTabId);
    if (currentActiveTab) {
      const activePane = findPaneNode(currentActiveTab.rootNode, currentActiveTab.activePaneId);
      if (activePane?.sessionId && isTauriRuntime()) {
        inheritedCwd = (await getTerminalCwd(activePane.sessionId)) ?? activePane.cwd ?? undefined;
      } else {
        inheritedCwd = activePane?.cwd ?? undefined;
      }
    }

    const tab = createTab(nextTabIndex.current, inheritedCwd);
    nextTabIndex.current += 1;
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.clientId);
    setSearchOpen(false);
  }, [activeTabId]);

  const splitActiveTerminal = useCallback(
    async (direction: SplitDirection, targetPaneId?: string) => {
      const currentActiveTab = tabsRef.current.find((t) => t.clientId === activeTabId);
      if (!currentActiveTab) return;

      const paneToSplitId = targetPaneId || currentActiveTab.activePaneId;
      const targetPane = findPaneNode(currentActiveTab.rootNode, paneToSplitId);

      let inheritedCwd: string | undefined;
      if (targetPane?.sessionId && isTauriRuntime()) {
        inheritedCwd = (await getTerminalCwd(targetPane.sessionId)) ?? targetPane.cwd ?? undefined;
      } else {
        inheritedCwd = targetPane?.cwd ?? undefined;
      }

      const newPaneNode = createPaneNode(inheritedCwd);
      const newPane = (newPaneNode as { pane: TerminalPaneModel }).pane;

      setTabs((current) =>
        current.map((tab) => {
          if (tab.clientId !== activeTabId) return tab;
          const updatedRoot = splitPaneInTree(tab.rootNode, paneToSplitId, direction, newPane);
          return {
            ...tab,
            rootNode: updatedRoot,
            activePaneId: newPane.paneId,
          };
        }),
      );
    },
    [activeTabId],
  );

  const openNewWindow = useCallback(() => {
    if (isTauriRuntime()) {
      const windowLabel = `glyph-win-${Date.now()}`;
      const webview = new WebviewWindow(windowLabel, {
        url: "index.html",
        title: "Glyph",
        width: 1180,
        height: 760,
        minWidth: 860,
        minHeight: 520,
        decorations: false,
        resizable: true,
        center: true,
      });
      webview.once("tauri://error", (err) => {
        console.error("Failed to create new Glyph window:", err);
      });
    } else {
      window.open(window.location.href, "_blank");
    }
  }, []);

  const closeTab = useCallback(
    (clientId: string) => {
      setTabs((currentTabs) => {
        if (currentTabs.length <= 1) {
          return currentTabs;
        }

        const tabIndex = currentTabs.findIndex((tab) => tab.clientId === clientId);
        const nextTabs = currentTabs.filter((tab) => tab.clientId !== clientId);

        const targetTab = currentTabs.find((t) => t.clientId === clientId);
        if (targetTab) {
          const panes = getAllPanesInTree(targetTab.rootNode);
          panes.forEach((p) => clearBlocks(p.paneId));
        }

        if (activeTabId === clientId) {
          const nextActive = nextTabs[Math.min(Math.max(tabIndex, 0), nextTabs.length - 1)];
          setActiveTabId(nextActive.clientId);
        }
        return nextTabs;
      });
    },
    [activeTabId, clearBlocks],
  );

  const closePane = useCallback(
    (clientId: string, paneId: string) => {
      setTabs((currentTabs) => {
        const tab = currentTabs.find((t) => t.clientId === clientId);
        if (!tab) return currentTabs;

        const allPanes = getAllPanesInTree(tab.rootNode);
        if (allPanes.length <= 1) {
          if (currentTabs.length <= 1) {
            return currentTabs;
          }
          const tabIndex = currentTabs.findIndex((t) => t.clientId === clientId);
          const nextTabs = currentTabs.filter((t) => t.clientId !== clientId);
          clearBlocks(paneId);

          if (activeTabId === clientId) {
            const nextActive = nextTabs[Math.min(Math.max(tabIndex, 0), nextTabs.length - 1)];
            setActiveTabId(nextActive.clientId);
          }
          return nextTabs;
        }

        const updatedRoot = removePaneFromTree(tab.rootNode, paneId);
        if (!updatedRoot) {
          return currentTabs;
        }

        clearBlocks(paneId);
        const remainingPanes = getAllPanesInTree(updatedRoot);
        const nextActivePaneId =
          tab.activePaneId === paneId ? remainingPanes[0].paneId : tab.activePaneId;

        return currentTabs.map((t) =>
          t.clientId === clientId
            ? {
                ...t,
                rootNode: updatedRoot,
                activePaneId: nextActivePaneId,
              }
            : t,
        );
      });
    },
    [activeTabId, clearBlocks],
  );

  const handleActivatePane = useCallback((clientId: string, paneId: string) => {
    setTabs((current) =>
      current.map((t) => (t.clientId === clientId ? { ...t, activePaneId: paneId } : t)),
    );
  }, []);

  const handleResizeSplit = useCallback((clientId: string, splitId: string, ratio: number) => {
    setTabs((current) =>
      current.map((t) =>
        t.clientId === clientId
          ? { ...t, rootNode: updateSplitRatioInTree(t.rootNode, splitId, ratio) }
          : t,
      ),
    );
  }, []);

  const handleSessionReady = useCallback(
    (paneId: string, info: TerminalSessionInfo) => {
      setTabs((current) =>
        current.map((tab) => {
          const pane = findPaneNode(tab.rootNode, paneId);
          if (!pane) return tab;

          const tabIndex = current.findIndex((t) => t.clientId === tab.clientId) + 1;
          const displayTitle = formatTabTitle(tabIndex > 0 ? tabIndex : 1);

          const updatedRoot = updatePaneInTree(tab.rootNode, paneId, {
            sessionId: info.sessionId,
            shell: info.shell,
            cwd: info.cwd,
            cols: info.cols,
            rows: info.rows,
            status: "running",
            title: displayTitle,
          });

          return {
            ...tab,
            rootNode: updatedRoot,
            title: displayTitle,
          };
        }),
      );
    },
    [],
  );

  const handleTitleChange = useCallback((paneId: string, title: string) => {
    setTabs((current) =>
      current.map((tab) => {
        const pane = findPaneNode(tab.rootNode, paneId);
        if (!pane) return tab;

        const tabIndex = current.findIndex((t) => t.clientId === tab.clientId) + 1;
        const displayTitle = formatTabTitle(tabIndex > 0 ? tabIndex : 1);

        const updatedRoot = updatePaneInTree(tab.rootNode, paneId, { title: displayTitle });
        return {
          ...tab,
          rootNode: updatedRoot,
          title: displayTitle,
        };
      }),
    );
  }, []);

  const handleSessionResize = useCallback((paneId: string, cols: number, rows: number) => {
    setTabs((current) =>
      current.map((tab) => {
        const pane = findPaneNode(tab.rootNode, paneId);
        if (!pane) return tab;
        return {
          ...tab,
          rootNode: updatePaneInTree(tab.rootNode, paneId, { cols, rows }),
        };
      }),
    );
  }, []);

  const handleSessionStatus = useCallback((paneId: string, status: TerminalStatus, error?: string) => {
    setTabs((current) =>
      current.map((tab) => {
        const pane = findPaneNode(tab.rootNode, paneId);
        if (!pane) return tab;
        return {
          ...tab,
          rootNode: updatePaneInTree(tab.rootNode, paneId, { status, error }),
        };
      }),
    );
  }, []);

  const handleSemanticEvent = useCallback(
    (paneId: string, event: TerminalSemanticEvent) => {
      ingestSemanticEvent(paneId, event);
    },
    [ingestSemanticEvent],
  );

  const handleNextTab = useCallback(() => {
    const currentTabs = tabsRef.current;
    if (currentTabs.length <= 1) return;
    setActiveTabId((currentActiveId) => {
      const currentIndex = currentTabs.findIndex((t) => t.clientId === currentActiveId);
      const nextIndex = currentIndex < 0 || currentIndex >= currentTabs.length - 1 ? 0 : currentIndex + 1;
      return currentTabs[nextIndex].clientId;
    });
  }, []);

  const handlePrevTab = useCallback(() => {
    const currentTabs = tabsRef.current;
    if (currentTabs.length <= 1) return;
    setActiveTabId((currentActiveId) => {
      const currentIndex = currentTabs.findIndex((t) => t.clientId === currentActiveId);
      const prevIndex = currentIndex <= 0 ? currentTabs.length - 1 : currentIndex - 1;
      return currentTabs[prevIndex].clientId;
    });
  }, []);

  useKeyboardShortcuts({
    keybindings,
    onNewTerminal: addTerminal,
    onNewWindow: openNewWindow,
    onCloseTerminal: () => {
      const activeTab = tabsRef.current.find((t) => t.clientId === activeTabId);
      if (activeTab) {
        closePane(activeTab.clientId, activeTab.activePaneId);
      }
    },
    onSplitVertical: () => void splitActiveTerminal("vertical"),
    onSplitHorizontal: () => void splitActiveTerminal("horizontal"),
    onNextTab: handleNextTab,
    onPrevTab: handlePrevTab,
    onSearch: () => setSearchOpen(true),
    onToggleSettings: () => setSettingsOpen((open) => !open),
  });

  return (
    <div className="app-shell">
      <WindowResizeHandles />
      <MatrixDotBackground
        style={settings.matrixStyle}
        speed={settings.matrixSpeed}
        interactive={settings.interactiveGlow}
        opacity={settings.dotOpacity}
        dotColor={settings.dotColor}
      />
      <TitleBar
        onNewWindow={openNewWindow}
        onSearch={() => setSearchOpen(true)}
        onToggleSettings={() => setSettingsOpen((open) => !open)}
        showPerformanceBar={settings.showPerformanceBar}
      />
      <main className="workspace">
        <TerminalTabs
          activeTabId={activeTab.clientId}
          tabs={tabs}
          onActivate={(clientId) => {
            setActiveTabId(clientId);
            setSearchOpen(false);
          }}
          onClose={closeTab}
          onNewTerminal={addTerminal}
        />
        <section className="terminal-stage" aria-label="Terminal sessions">
          {tabs.map((tab) => {
            const isTabActive = tab.clientId === activeTab.clientId;
            const panes = getAllPanesInTree(tab.rootNode);

            return (
              <div
                key={tab.clientId}
                className={isTabActive ? "terminal-stage-tab is-active" : "terminal-stage-tab"}
                style={{
                  display: isTabActive ? "flex" : "none",
                  width: "100%",
                  height: "100%",
                  position: "absolute",
                  inset: 0,
                }}
              >
                <TerminalSplitView
                  activePaneId={tab.activePaneId}
                  activeTab={isTabActive}
                  blocksByPane={blocksByTab}
                  keybindings={keybindings}
                  node={tab.rootNode}
                  paneCount={panes.length}
                  searchOpen={searchOpen && isTabActive}
                  settings={settings}
                  tabId={tab.clientId}
                  onActivatePane={(paneId) => handleActivatePane(tab.clientId, paneId)}
                  onClosePane={(paneId) => closePane(tab.clientId, paneId)}
                  onCloseSearch={() => setSearchOpen(false)}
                  onCloseTerminal={() => closePane(tab.clientId, tab.activePaneId)}
                  onNewTerminal={addTerminal}
                  onNewWindow={openNewWindow}
                  onNextTab={handleNextTab}
                  onPrevTab={handlePrevTab}
                  onResizeSplit={(splitId, ratio) => handleResizeSplit(tab.clientId, splitId, ratio)}
                  onSearch={() => setSearchOpen(true)}
                  onSemanticEvent={handleSemanticEvent}
                  onSessionReady={handleSessionReady}
                  onSessionResize={handleSessionResize}
                  onSessionStatus={handleSessionStatus}
                  onSplitHorizontal={(paneId) => void splitActiveTerminal("horizontal", paneId)}
                  onSplitVertical={(paneId) => void splitActiveTerminal("vertical", paneId)}
                  onTitleChange={handleTitleChange}
                  onToggleSettings={() => setSettingsOpen((open) => !open)}
                />
              </div>
            );
          })}
        </section>
        <Settings
          open={settingsOpen}
          settings={settings}
          keybindings={keybindings}
          onUpdateSettings={updateSettings}
          onUpdateKeybinding={updateKeybinding}
          onResetKeybindings={resetKeybindings}
        />
      </main>
    </div>
  );
}
