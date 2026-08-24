import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

import type {
  TerminalBlock as TerminalBlockModel,
  TerminalPaneModel,
  TerminalSemanticEvent,
  TerminalSessionInfo,
  TerminalStatus,
} from "../../lib/terminal/types";
import type { KeybindingsConfig } from "../../hooks/useKeybindings";
import type { TerminalSettings } from "../../hooks/useTerminalSettings";
import { TerminalView } from "./TerminalView";

type TerminalPanePortalsProps = {
  activeTab: boolean;
  activePaneId: string;
  blocksByPane: Record<string, TerminalBlockModel[]>;
  keybindings: KeybindingsConfig;
  panes: TerminalPaneModel[];
  paneCount: number;
  searchOpen: boolean;
  settings?: TerminalSettings;
  tabId: string;
  onActivatePane: (paneId: string) => void;
  onClosePane?: (paneId: string) => void;
  onCloseSearch: () => void;
  onCloseTerminal?: () => void;
  onNewTerminal?: () => void;
  onNewWindow?: () => void;
  onNextTab?: () => void;
  onPrevTab?: () => void;
  onSearch?: () => void;
  onSemanticEvent: (paneId: string, event: TerminalSemanticEvent) => void;
  onSessionReady: (paneId: string, info: TerminalSessionInfo) => void;
  onSessionResize: (paneId: string, cols: number, rows: number) => void;
  onSessionStatus: (paneId: string, status: TerminalStatus, error?: string) => void;
  onSplitHorizontal?: (paneId: string) => void;
  onSplitVertical?: (paneId: string) => void;
  onTitleChange?: (paneId: string, title: string) => void;
  onToggleSettings?: () => void;
};

/**
 * Renders all TerminalView instances for a tab using React portals into
 * stable container elements. This prevents React from unmounting terminals
 * when the split tree structure changes (e.g. when splitting a pane).
 *
 * Each TerminalView is rendered into a persistent container div that is
 * imperatively reparented (via DOM appendChild) into the matching
 * `[data-pane-target]` placeholder rendered by TerminalSplitView.
 * Because the portal container is stable, React never unmounts the
 * TerminalView — only the physical DOM location changes.
 */
export function TerminalPanePortals({
  activeTab,
  activePaneId,
  blocksByPane,
  keybindings,
  onActivatePane,
  onClosePane,
  onCloseSearch,
  onCloseTerminal,
  onNewTerminal,
  onNewWindow,
  onNextTab,
  onPrevTab,
  onSearch,
  onSemanticEvent,
  onSessionReady,
  onSessionResize,
  onSessionStatus,
  onSplitHorizontal,
  onSplitVertical,
  onTitleChange,
  onToggleSettings,
  panes,
  paneCount,
  searchOpen,
  settings,
  tabId,
}: TerminalPanePortalsProps) {
  // Stable container elements keyed by paneId.
  // These are never recreated for a given paneId, which means
  // the TerminalView rendered inside (via createPortal) is never unmounted.
  const containersRef = useRef(new Map<string, HTMLDivElement>());

  // Lazily create containers for any new panes.
  // This is safe during render because we're only creating detached
  // DOM elements (not mutating the document).
  for (const pane of panes) {
    if (!containersRef.current.has(pane.paneId)) {
      const el = document.createElement("div");
      el.className = "pane-portal-container";
      el.style.width = "100%";
      el.style.height = "100%";
      containersRef.current.set(pane.paneId, el);
    }
  }

  // Remove containers for panes that no longer exist.
  // Run inside useLayoutEffect so we don't mutate refs during render.
  const paneIdSet = new Set(panes.map((p) => p.paneId));
  useLayoutEffect(() => {
    for (const [id, el] of containersRef.current) {
      if (!paneIdSet.has(id)) {
        el.remove();
        containersRef.current.delete(id);
      }
    }
  });

  // Reparent each stable container into its matching placeholder div
  // rendered by TerminalSplitView. useLayoutEffect ensures this runs
  // synchronously after DOM mutations but before the browser paints,
  // so the user never sees a frame where the terminal is misplaced.
  useLayoutEffect(() => {
    for (const pane of panes) {
      const target = document.querySelector<HTMLElement>(
        `[data-pane-target="${pane.paneId}"]`,
      );
      const container = containersRef.current.get(pane.paneId);
      if (target && container && container.parentElement !== target) {
        target.appendChild(container);
      }
    }
  });

  return (
    <>
      {panes.map((pane) => {
        const container = containersRef.current.get(pane.paneId);
        if (!container) return null;
        const isPaneActive = pane.paneId === activePaneId;
        return createPortal(
          <TerminalView
            key={pane.paneId}
            active={activeTab}
            blocks={blocksByPane[pane.paneId] ?? []}
            canClosePane={paneCount > 1}
            isPaneActive={isPaneActive}
            isSplit={paneCount > 1}
            keybindings={keybindings}
            onActivatePane={onActivatePane}
            onClosePane={onClosePane}
            onCloseSearch={onCloseSearch}
            onCloseTerminal={onCloseTerminal}
            onNewTerminal={onNewTerminal}
            onNewWindow={onNewWindow}
            onNextTab={onNextTab}
            onPrevTab={onPrevTab}
            onSearch={onSearch}
            onSemanticEvent={onSemanticEvent}
            onSessionReady={onSessionReady}
            onSessionResize={onSessionResize}
            onSessionStatus={onSessionStatus}
            onSplitHorizontal={onSplitHorizontal}
            onSplitVertical={onSplitVertical}
            onTitleChange={onTitleChange}
            onToggleSettings={onToggleSettings}
            pane={pane}
            searchOpen={searchOpen}
            settings={settings}
            tabId={tabId}
          />,
          container,
        );
      })}
    </>
  );
}
