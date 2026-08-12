import type { TerminalTabModel } from "../../lib/terminal/types";
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
        {tabs.map((tab) => (
          <TerminalTab
            key={tab.clientId}
            active={tab.clientId === activeTabId}
            canClose={tabs.length > 1}
            tab={tab}
            onActivate={onActivate}
            onClose={onClose}
          />
        ))}
      </div>
      <button
        aria-label="New Terminal Tab (Ctrl+Shift+T)"
        className="tabs-new"
        title="New Terminal Tab (Ctrl+Shift+T)"
        type="button"
        onClick={onNewTerminal}
      >
        <span>+</span>
        <span className="tabs-new-label">New Terminal</span>
      </button>
    </aside>
  );
}
