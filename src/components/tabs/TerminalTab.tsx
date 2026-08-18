import type { TerminalStatus, TerminalTabModel } from "../../lib/terminal/types";

type TerminalTabProps = {
  active: boolean;
  canClose: boolean;
  tab: TerminalTabModel;
  status: TerminalStatus;
  paneCount: number;
  onActivate: (clientId: string) => void;
  onClose: (clientId: string) => void;
};

export function TerminalTab({
  active,
  canClose,
  onActivate,
  onClose,
  paneCount,
  status,
  tab,
}: TerminalTabProps) {
  const displayTitle = paneCount > 1 ? `${tab.title} (${paneCount} Panes)` : tab.title;

  return (
    <div className={active ? "terminal-tab is-active" : "terminal-tab"}>
      <button
        aria-selected={active}
        className="terminal-tab-main"
        role="tab"
        title={displayTitle}
        type="button"
        onClick={() => onActivate(tab.clientId)}
      >
        <span className={`tab-status tab-status-${status}`} aria-hidden="true" />
        <span className="tab-title">{displayTitle}</span>
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
