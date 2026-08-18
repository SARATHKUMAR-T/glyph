import type { TerminalTabModel } from "../../lib/terminal/types";
import { getAllPanesInTree } from "../../lib/terminal/splitTree";
import { TerminalTab } from "./TerminalTab";

type TerminalTabsProps = {
  activeTabId: string;
  tabs: TerminalTabModel[];
  onActivate: (clientId: string) => void;
  onClose: (clientId: string) => void;
  onNewTerminal: () => void;
};

export function TerminalTabs({
  activeTabId,
  onActivate,
  onClose,
  onNewTerminal,
  tabs,
}: TerminalTabsProps) {
  return (
    <aside className="terminal-tabs" role="tablist" aria-label="Terminal tabs sidebar">
      <div className="tabs-header">
        <span className="tabs-header-title">TERMINALS ({tabs.length})</span>
      </div>
      <div className="tabs-container">
        {tabs.map((tab) => {
          const panes = getAllPanesInTree(tab.rootNode);
          const activePane = panes.find((p) => p.paneId === tab.activePaneId) ?? panes[0];
          const status = activePane?.status ?? "starting";

          return (
            <TerminalTab
              key={tab.clientId}
              active={tab.clientId === activeTabId}
              canClose={tabs.length > 1}
              tab={tab}
              status={status}
              paneCount={panes.length}
              onActivate={onActivate}
              onClose={onClose}
            />
          );
        })}

        <button
          aria-label="New Terminal Tab (Ctrl+Shift+T)"
          className="tabs-new"
          title="New Terminal Tab (Ctrl+Shift+T)"
          type="button"
          onClick={onNewTerminal}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
