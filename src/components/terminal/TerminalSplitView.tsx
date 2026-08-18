import type {
  SplitNode,
  TerminalBlock as TerminalBlockModel,
  TerminalPaneModel,
  TerminalSemanticEvent,
  TerminalSessionInfo,
  TerminalStatus,
} from "../../lib/terminal/types";
import type { KeybindingsConfig } from "../../hooks/useKeybindings";
import type { TerminalSettings } from "../../hooks/useTerminalSettings";
import { SplitResizer } from "./SplitResizer";
import { TerminalView } from "./TerminalView";

type TerminalSplitViewProps = {
  activeTab: boolean;
  activePaneId: string;
  blocksByPane: Record<string, TerminalBlockModel[]>;
  keybindings: KeybindingsConfig;
  node: SplitNode;
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
  onResizeSplit: (splitId: string, ratio: number) => void;
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

export function TerminalSplitView({
  activePaneId,
  activeTab,
  blocksByPane,
  keybindings,
  node,
  onActivatePane,
  onClosePane,
  onCloseSearch,
  onCloseTerminal,
  onNewTerminal,
  onNewWindow,
  onNextTab,
  onPrevTab,
  onResizeSplit,
  onSearch,
  onSemanticEvent,
  onSessionReady,
  onSessionResize,
  onSessionStatus,
  onSplitHorizontal,
  onSplitVertical,
  onTitleChange,
  onToggleSettings,
  paneCount,
  searchOpen,
  settings,
  tabId,
}: TerminalSplitViewProps) {
  if (node.type === "pane") {
    const isPaneActive = node.pane.paneId === activePaneId;
    return (
      <TerminalView
        key={node.pane.paneId}
        active={activeTab}
        blocks={blocksByPane[node.pane.paneId] ?? []}
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
        pane={node.pane}
        searchOpen={searchOpen}
        settings={settings}
        tabId={tabId}
      />
    );
  }

  const isVertical = node.direction === "vertical";
  const flexDir = isVertical ? "row" : "column";
  const flexStyle0 = { flex: `${node.ratio} ${node.ratio} 0%` };
  const flexStyle1 = { flex: `${1 - node.ratio} ${1 - node.ratio} 0%` };

  return (
    <div
      className={`split-container split-container-${node.direction}`}
      style={{ display: "flex", flexDirection: flexDir, width: "100%", height: "100%" }}
    >
      <div className="split-pane-wrapper" style={flexStyle0}>
        <TerminalSplitView
          activePaneId={activePaneId}
          activeTab={activeTab}
          blocksByPane={blocksByPane}
          keybindings={keybindings}
          node={node.children[0]}
          onActivatePane={onActivatePane}
          onClosePane={onClosePane}
          onCloseSearch={onCloseSearch}
          onCloseTerminal={onCloseTerminal}
          onNewTerminal={onNewTerminal}
          onNewWindow={onNewWindow}
          onNextTab={onNextTab}
          onPrevTab={onPrevTab}
          onResizeSplit={onResizeSplit}
          onSearch={onSearch}
          onSemanticEvent={onSemanticEvent}
          onSessionReady={onSessionReady}
          onSessionResize={onSessionResize}
          onSessionStatus={onSessionStatus}
          onSplitHorizontal={onSplitHorizontal}
          onSplitVertical={onSplitVertical}
          onTitleChange={onTitleChange}
          onToggleSettings={onToggleSettings}
          paneCount={paneCount}
          searchOpen={searchOpen}
          settings={settings}
          tabId={tabId}
        />
      </div>

      <SplitResizer
        direction={node.direction}
        onResize={(newRatio) => onResizeSplit(node.id, newRatio)}
      />

      <div className="split-pane-wrapper" style={flexStyle1}>
        <TerminalSplitView
          activePaneId={activePaneId}
          activeTab={activeTab}
          blocksByPane={blocksByPane}
          keybindings={keybindings}
          node={node.children[1]}
          onActivatePane={onActivatePane}
          onClosePane={onClosePane}
          onCloseSearch={onCloseSearch}
          onCloseTerminal={onCloseTerminal}
          onNewTerminal={onNewTerminal}
          onNewWindow={onNewWindow}
          onNextTab={onNextTab}
          onPrevTab={onPrevTab}
          onResizeSplit={onResizeSplit}
          onSearch={onSearch}
          onSemanticEvent={onSemanticEvent}
          onSessionReady={onSessionReady}
          onSessionResize={onSessionResize}
          onSessionStatus={onSessionStatus}
          onSplitHorizontal={onSplitHorizontal}
          onSplitVertical={onSplitVertical}
          onTitleChange={onTitleChange}
          onToggleSettings={onToggleSettings}
          paneCount={paneCount}
          searchOpen={searchOpen}
          settings={settings}
          tabId={tabId}
        />
      </div>
    </div>
  );
}
