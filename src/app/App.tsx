import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

import { Settings } from "../components/settings/Settings";
import { TerminalView } from "../components/terminal/TerminalView";
import { TerminalTabs } from "../components/tabs/TerminalTabs";
import { TitleBar } from "../components/window/TitleBar";
import { WindowResizeHandles } from "../components/window/WindowResizeHandles";
import { MatrixDotBackground } from "../components/terminal/MatrixDotBackground";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useTerminalBlocks } from "../hooks/useTerminalBlocks";
import { useTerminalSettings } from "../hooks/useTerminalSettings";
import { useKeybindings } from "../hooks/useKeybindings";
import { isTauriRuntime } from "../lib/terminal/events";
import type {
  TerminalSemanticEvent,
  TerminalSessionInfo,
  TerminalStatus,
  TerminalTabModel,
} from "../lib/terminal/types";

function createClientId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function createTab(index: number): TerminalTabModel {
  return {
    clientId: createClientId(),
    title: `Terminal ${index}`,
    status: "starting",
  };
}

function formatTabTitle(index: number, rawTitle?: string): string {
  const baseName = `Terminal ${index}`;
  if (!rawTitle || !rawTitle.trim()) return baseName;

  let formatted = rawTitle.trim();
  const homeMatch = formatted.match(/\/home\/[^/]+/);
  if (homeMatch) {
    formatted = formatted.replace(homeMatch[0], "~");
  }

  if (formatted.includes(":")) {
    const colonIndex = formatted.indexOf(":");
    formatted = formatted.slice(colonIndex + 1).trim();
  }

  // Don't append trivial/empty suffixes like "~" or "-"
  if (!formatted || formatted === baseName || formatted === "~" || formatted === "-") {
    return baseName;
  }

  return `${baseName} (${formatted})`;
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

  const updateTab = useCallback(
    (clientId: string, patch: Partial<TerminalTabModel>) => {
      setTabs((current) =>
        current.map((tab) => (tab.clientId === clientId ? { ...tab, ...patch } : tab)),
      );
    },
    [],
  );

  const addTerminal = useCallback(() => {
    const tab = createTab(nextTabIndex.current);
    nextTabIndex.current += 1;
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.clientId);
    setSearchOpen(false);
  }, []);

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
        clearBlocks(clientId);

        if (activeTabId === clientId) {
          const nextActive = nextTabs[Math.min(Math.max(tabIndex, 0), nextTabs.length - 1)];
          setActiveTabId(nextActive.clientId);
        }
        return nextTabs;
      });
    },
    [activeTabId, clearBlocks],
  );

  const handleSessionReady = useCallback(
    (clientId: string, info: TerminalSessionInfo) => {
      setTabs((current) =>
        current.map((tab) => {
          if (tab.clientId !== clientId) return tab;
          const tabIndex = current.findIndex((t) => t.clientId === clientId) + 1;
          const displayTitle = formatTabTitle(tabIndex > 0 ? tabIndex : 1, info.cwd || "~");
          return {
            ...tab,
            sessionId: info.sessionId,
            shell: info.shell,
            cwd: info.cwd,
            title: displayTitle,
            cols: info.cols,
            rows: info.rows,
            status: "running",
          };
        }),
      );
    },
    [],
  );

  const handleTitleChange = useCallback(
    (clientId: string, title: string) => {
      setTabs((current) =>
        current.map((tab) => {
          if (tab.clientId !== clientId) return tab;
          const tabIndex = current.findIndex((t) => t.clientId === clientId) + 1;
          const displayTitle = formatTabTitle(tabIndex > 0 ? tabIndex : 1, title);
          return { ...tab, title: displayTitle };
        }),
      );
    },
    [],
  );

  const handleSessionResize = useCallback(
    (clientId: string, cols: number, rows: number) => {
      updateTab(clientId, { cols, rows });
    },
    [updateTab],
  );

  const handleSessionStatus = useCallback(
    (clientId: string, status: TerminalStatus, error?: string) => {
      updateTab(clientId, { status, error });
    },
    [updateTab],
  );

  const handleSemanticEvent = useCallback(
    (clientId: string, event: TerminalSemanticEvent) => {
      ingestSemanticEvent(clientId, event);
    },
    [ingestSemanticEvent],
  );

  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

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
    onCloseTerminal: () => closeTab(activeTab.clientId),
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
          {tabs.map((tab) => (
            <TerminalView
              key={tab.clientId}
              active={tab.clientId === activeTab.clientId}
              blocks={blocksByTab[tab.clientId] ?? []}
              keybindings={keybindings}
              searchOpen={searchOpen && tab.clientId === activeTab.clientId}
              settings={settings}
              tab={tab}
              onCloseSearch={() => setSearchOpen(false)}
              onCloseTerminal={() => closeTab(activeTab.clientId)}
              onNewTerminal={addTerminal}
              onNewWindow={openNewWindow}
              onNextTab={handleNextTab}
              onPrevTab={handlePrevTab}
              onSearch={() => setSearchOpen(true)}
              onSemanticEvent={handleSemanticEvent}
              onSessionReady={handleSessionReady}
              onSessionResize={handleSessionResize}
              onSessionStatus={handleSessionStatus}
              onTitleChange={handleTitleChange}
              onToggleSettings={() => setSettingsOpen((open) => !open)}
            />
          ))}
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
