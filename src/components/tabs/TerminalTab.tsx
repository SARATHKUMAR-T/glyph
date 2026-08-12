import type { TerminalTabModel } from "../../lib/terminal/types";

type TerminalTabProps = {
  active: boolean;
  canClose: boolean;
  tab: TerminalTabModel;
  onActivate: (clientId: string) => void;
  onClose: (clientId: string) => void;
};

export function TerminalTab({ active, canClose, onActivate, onClose, tab }: TerminalTabProps) {
  return (
    <div className={active ? "terminal-tab is-active" : "terminal-tab"}>
      <button
        aria-selected={active}
        className="terminal-tab-main"
        role="tab"
        title={tab.shell ?? tab.title}
        type="button"
        onClick={() => onActivate(tab.clientId)}
      >
        <span className={`tab-status tab-status-${tab.status}`} aria-hidden="true" />
        <span className="tab-title">{tab.title}</span>
      </button>
      <button
        aria-label={`Close ${tab.title}`}
        className="terminal-tab-close"
        disabled={!canClose}
        title="Close"
        type="button"
        onClick={() => onClose(tab.clientId)}
      >
        ×
      </button>
    </div>
  );
}
