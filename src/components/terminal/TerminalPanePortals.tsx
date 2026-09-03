import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { ITheme } from "@xterm/xterm";

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
  /**
   * The pane id currently shown enlarged in the expanded-pane modal, if any.
   */
  expandedPaneId?: string;
  isWindowMaximized?: boolean;
  searchOpen: boolean;
  settings?: TerminalSettings;
  /** Active xterm palette from useTerminalTheme — threaded into every pane */
  xtermTheme?: ITheme;
  tabId: string;
  onActivatePane: (paneId: string) => void;
  onClosePane?: (paneId: string) => void;
  onCloseSearch: () => void;
  onCloseTerminal?: () => void;
  onExpandPane?: (paneId: string) => void;
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
  expandedPaneId,
  isWindowMaximized,
  onExpandPane,
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
  xtermTheme,
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
  //
  // Runs on every render (no dependency array) because React's DOM
  // reconciliation can reuse elements at the same position — a
  // `data-pane-target="P3"` div might become `data-pane-target="P2"`
  // with P3's container still inside. We rely on `appendChild`
  // automatically moving elements to handle cross-contamination:
  // when pane P3's iteration runs, it moves P3's container from
  // P2's target to P3's target, leaving P2's target with only P2.
  useLayoutEffect(() => {
    let didReparent = false;
    for (const pane of panes) {
      const target = document.querySelector<HTMLElement>(
        `[data-pane-target="${pane.paneId}"]`,
      );
      const container = containersRef.current.get(pane.paneId);
      if (target && container && container.parentElement !== target) {
        target.appendChild(container);
        didReparent = true;
      }
    }
    // After reparenting, force xterm instances to recalculate their
    // dimensions since their host containers may have changed size.
    if (didReparent) {
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
      });
      setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
      }, 50);
    }
  });

  // Automatically focus the enlarged terminal so user can type immediately
  useEffect(() => {
    if (expandedPaneId) {
      const timer = setTimeout(() => {
        const container = containersRef.current.get(expandedPaneId);
        const textarea = container?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");
        textarea?.focus();
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [expandedPaneId]);

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
            isExpanded={expandedPaneId === pane.paneId}
            isWindowMaximized={isWindowMaximized}
            keybindings={keybindings}
            onActivatePane={onActivatePane}
            onClosePane={onClosePane}
            onCloseSearch={onCloseSearch}
            onCloseTerminal={onCloseTerminal}
            onExpandPane={onExpandPane}
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
            xtermTheme={xtermTheme}
            tabId={tabId}
          />,
          container,
        );
      })}
    </>
  );
}
