import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

import "../styles/workspace.css";
import { Settings } from "../components/settings/Settings";
import { TerminalPanePortals } from "../components/terminal/TerminalPanePortals";
import { TerminalSplitView } from "../components/terminal/TerminalSplitView";
import { TerminalTabs } from "../components/tabs/TerminalTabs";
import { TitleBar } from "../components/window/TitleBar";
import { WindowResizeHandles } from "../components/window/WindowResizeHandles";
import { MatrixDotBackground } from "../components/terminal/MatrixDotBackground";
import { CreateWorkspaceModal } from "../components/workspace/CreateWorkspaceModal";
import { SaveCurrentWorkspaceModal } from "../components/workspace/SaveCurrentWorkspaceModal";
import { WorkspaceManagerModal } from "../components/workspace/WorkspaceManagerModal";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useTerminalBlocks } from "../hooks/useTerminalBlocks";
import { useTerminalSettings } from "../hooks/useTerminalSettings";
import { useSettingsAutoDismiss } from "../hooks/useSettingsAutoDismiss";
import { useTerminalTheme } from "../hooks/useTerminalTheme";
import { useIsWindowMaximized } from "../hooks/useIsWindowMaximized";
import { getTheme } from "../lib/terminal/themes";
import { useKeybindings } from "../hooks/useKeybindings";
import { useWorkspaces } from "../hooks/useWorkspaces";
import { isTauriRuntime } from "../lib/terminal/events";
import { getTerminalCwd } from "../hooks/useTerminalSession";
import { workspaceLayoutToSplitNode } from "../lib/workspace/treeConverter";
import type { Workspace } from "../lib/workspace/types";
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
  useSettingsAutoDismiss(settingsOpen, () => setSettingsOpen(false));
  const { blocksByTab, clearBlocks, ingestSemanticEvent } = useTerminalBlocks();
  const { settings, updateSettings } = useTerminalSettings();
  const xtermTheme = useTerminalTheme(settings.themeId);
  const { keybindings, updateKeybinding, resetKeybindings } = useKeybindings();
  const { workspaces, saveWorkspace, deleteWorkspace } = useWorkspaces();

  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [saveCurrentWorkspaceOpen, setSaveCurrentWorkspaceOpen] = useState(false);
  const [manageWorkspacesOpen, setManageWorkspacesOpen] = useState(false);
  const [expandedPane, setExpandedPane] = useState<{ tabId: string; paneId: string } | null>(null);

  const handleOpenWorkspace = useCallback((workspace: Workspace) => {
    const { rootNode } = workspaceLayoutToSplitNode(workspace.layout, workspace.panes);
    const panes = getAllPanesInTree(rootNode);

    const newTab: TerminalTabModel = {
      clientId: createId(),
      title: workspace.name,
      rootNode,
      activePaneId: panes[0]?.paneId || createId(),
    };

    setTabs((current) => [...current, newTab]);
    setActiveTabId(newTab.clientId);
    setSearchOpen(false);
  }, []);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.clientId === activeTabId) ?? tabs[0],
    [activeTabId, tabs],
  );

  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const isWindowMaximized = useIsWindowMaximized();

  // Dismiss enlarged pane if the window is unmaximized / restored down
  useEffect(() => {
    if (!isWindowMaximized && expandedPane) {
      setExpandedPane(null);
    }
  }, [isWindowMaximized, expandedPane]);

  // Close the enlarged-pane modal with Escape.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && expandedPane) {
        setExpandedPane(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expandedPane]);

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

        // Dismiss the enlarged-pane modal if its tab was closed.
        setExpandedPane((current) => (current?.tabId === clientId ? null : current));
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

        // Dismiss the enlarged-pane modal if the enlarged pane was closed.
        setExpandedPane((current) =>
          current?.tabId === clientId && current.paneId === paneId ? null : current,
        );

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
          const fallbackTitle = formatTabTitle(tabIndex > 0 ? tabIndex : 1);
          const newPaneTitle = pane.title || fallbackTitle;
          const newTabTitle = tab.title || fallbackTitle;

          const updatedRoot = updatePaneInTree(tab.rootNode, paneId, {
            sessionId: info.sessionId,
            shell: info.shell,
            cwd: info.cwd,
            cols: info.cols,
            rows: info.rows,
            status: "running",
            title: newPaneTitle,
          });

          return {
            ...tab,
            rootNode: updatedRoot,
            title: newTabTitle,
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

        // Preserve custom pane title (e.g., workspace pane names) if configured
        const newPaneTitle = pane.title || title;
        const updatedRoot = updatePaneInTree(tab.rootNode, paneId, { title: newPaneTitle });

        return {
          ...tab,
          rootNode: updatedRoot,
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
    setExpandedPane(null);
    const currentTabs = tabsRef.current;
    if (currentTabs.length <= 1) return;
    setActiveTabId((currentActiveId) => {
      const currentIndex = currentTabs.findIndex((t) => t.clientId === currentActiveId);
      const nextIndex = currentIndex < 0 || currentIndex >= currentTabs.length - 1 ? 0 : currentIndex + 1;
      return currentTabs[nextIndex].clientId;
    });
  }, []);

  const handlePrevTab = useCallback(() => {
    setExpandedPane(null);
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
    onSearch: () => {
      setSearchOpen(true);
      setSettingsOpen(false);
    },
    onToggleSettings: () => setSettingsOpen((open) => !open),
    onOpenWorkspace: () => {
      setManageWorkspacesOpen(true);
      setSettingsOpen(false);
    },
    onSaveWorkspace: () => {
      setSaveCurrentWorkspaceOpen(true);
      setSettingsOpen(false);
    },
  });

  const currentExpandedTab = tabs.find((t) => t.clientId === expandedPane?.tabId);
  const expandedPaneModel =
    currentExpandedTab && expandedPane
      ? findPaneNode(currentExpandedTab.rootNode, expandedPane.paneId)
      : null;

  return (
    <div className="app-shell">
      <WindowResizeHandles />
      <MatrixDotBackground
        enabled={getTheme(settings.themeId).category !== "light"}
        style={settings.matrixStyle}
        speed={settings.matrixSpeed}
        interactive={settings.interactiveGlow}
        opacity={settings.dotOpacity}
        dotColor={settings.dotColor}
      />
      <TitleBar
        onNewWindow={openNewWindow}
        onSearch={() => {
          setSearchOpen(true);
          setSettingsOpen(false);
        }}
        onToggleSettings={() => setSettingsOpen((open) => !open)}
        showPerformanceBar={settings.showPerformanceBar}
        workspaces={workspaces}
        onOpenWorkspace={handleOpenWorkspace}
        onCreateWorkspace={() => {
          setCreateWorkspaceOpen(true);
          setSettingsOpen(false);
        }}
        onSaveCurrentWorkspace={() => {
          setSaveCurrentWorkspaceOpen(true);
          setSettingsOpen(false);
        }}
        onManageWorkspaces={() => {
          setManageWorkspacesOpen(true);
          setSettingsOpen(false);
        }}
      />
      <main className="workspace">
        <TerminalTabs
          activeTabId={activeTab.clientId}
          tabs={tabs}
          onActivate={(clientId) => {
            setActiveTabId(clientId);
            setSearchOpen(false);
            setSettingsOpen(false);
            setExpandedPane(null);
          }}
          onClose={closeTab}
          onNewTerminal={() => {
            addTerminal();
            setSettingsOpen(false);
            setExpandedPane(null);
          }}
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
                  node={tab.rootNode}
                  onResizeSplit={(splitId, ratio) => handleResizeSplit(tab.clientId, splitId, ratio)}
                  expandedPaneId={
                    expandedPane?.tabId === tab.clientId ? expandedPane.paneId : undefined
                  }
                />
                <TerminalPanePortals
                  activePaneId={tab.activePaneId}
                  activeTab={isTabActive}
                  blocksByPane={blocksByTab}
                  keybindings={keybindings}
                  panes={panes}
                  paneCount={panes.length}
                  expandedPaneId={
                    expandedPane?.tabId === tab.clientId ? expandedPane.paneId : undefined
                  }
                  isWindowMaximized={isWindowMaximized}
                  searchOpen={searchOpen && isTabActive}
                  settings={settings}
                  xtermTheme={xtermTheme}
                  tabId={tab.clientId}
                  onActivatePane={(paneId) => handleActivatePane(tab.clientId, paneId)}
                  onClosePane={(paneId) => closePane(tab.clientId, paneId)}
                  onCloseSearch={() => setSearchOpen(false)}
                  onCloseTerminal={() => closePane(tab.clientId, tab.activePaneId)}
                  onExpandPane={(paneId) =>
                    setExpandedPane({ tabId: tab.clientId, paneId })
                  }
                  onNewTerminal={addTerminal}
                  onNewWindow={openNewWindow}
                  onNextTab={handleNextTab}
                  onPrevTab={handlePrevTab}
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

        {expandedPane && (
          <div
            className="expanded-pane-overlay"
            role="dialog"
            aria-modal="true"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setExpandedPane(null);
              }
            }}
          >
            <div className="expanded-pane-modal">
              <div className="expanded-pane-header">
                <div className="expanded-pane-title">
                  <span
                    className={`pane-status-dot pane-status-${expandedPaneModel?.status ?? "idle"}`}
                    aria-hidden="true"
                  />
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <span>{expandedPaneModel?.title || "Terminal"}</span>
                  <span className="expanded-pane-badge">Enlarged View</span>
                </div>
                <div className="expanded-pane-header-actions">
                  <button
                    type="button"
                    className="expanded-pane-btn"
                    title="Restore to Split (Esc)"
                    onClick={() => setExpandedPane(null)}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="4 14 10 14 10 20" />
                      <polyline points="20 10 14 10 14 4" />
                      <line x1="14" y1="10" x2="21" y2="3" />
                      <line x1="3" y1="21" x2="10" y2="14" />
                    </svg>
                    <span>Restore</span>
                  </button>
                  <button
                    type="button"
                    className="expanded-pane-close"
                    title="Close (Esc)"
                    onClick={() => setExpandedPane(null)}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>
              {/* Placeholder for the enlarged pane. The active pane's terminal
                  is reparented here (via TerminalPanePortals) when expanded. */}
              <div className="expanded-pane-body">
                <div
                  className="pane-portal-target expanded-pane-target"
                  data-pane-target={expandedPane.paneId}
                />
              </div>
            </div>
          </div>
        )}

        <Settings
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          settings={settings}
          keybindings={keybindings}
          onUpdateSettings={updateSettings}
          onUpdateKeybinding={updateKeybinding}
          onResetKeybindings={resetKeybindings}
        />
        <CreateWorkspaceModal
          isOpen={createWorkspaceOpen}
          onClose={() => setCreateWorkspaceOpen(false)}
          onSave={saveWorkspace}
        />
        <SaveCurrentWorkspaceModal
          isOpen={saveCurrentWorkspaceOpen}
          activeTab={activeTab}
          onClose={() => setSaveCurrentWorkspaceOpen(false)}
          onSave={saveWorkspace}
        />
        <WorkspaceManagerModal
          isOpen={manageWorkspacesOpen}
          workspaces={workspaces}
          onClose={() => setManageWorkspacesOpen(false)}
          onOpenWorkspace={handleOpenWorkspace}
          onSaveWorkspace={saveWorkspace}
          onDeleteWorkspace={deleteWorkspace}
        />
      </main>
    </div>
  );
}
