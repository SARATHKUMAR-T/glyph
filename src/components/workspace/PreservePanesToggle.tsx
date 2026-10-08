import type { WorkspacePaneConfig } from "../../lib/workspace/types";

/** Panes with a startup command — what Preserve Panes re-runs. */
export function countStartupCommands(panes: WorkspacePaneConfig[]): number {
  return panes.filter((pane) =>
    typeof pane.command === "string" ? pane.command.trim() !== "" : Boolean(pane.command?.program),
  ).length;
}

type PreservePanesToggleProps = {
  value: boolean;
  onChange: (value: boolean) => void;
  /** How many panes have a startup command to re-run. */
  commandCount: number;
};

/** The workspace "Preserve Panes" switch, shared by the create, save and
 * edit dialogs — see `Workspace.preservePanes`. The whole card is the
 * switch, so it's an easy target. */
export function PreservePanesToggle({ value, onChange, commandCount }: PreservePanesToggleProps) {
  const status = !value
    ? "Closing Glyph closes this workspace's tab."
    : commandCount === 0
      ? "Reopens on launch. Add a startup command to a pane to reconnect it too."
      : `Reopens on launch and re-runs ${commandCount} startup command${commandCount === 1 ? "" : "s"}.`;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      className={`preserve-card${value ? " is-on" : ""}`}
      onClick={() => onChange(!value)}
    >
      <span className="preserve-card-icon" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
          <path d="M3 21v-5h5" />
        </svg>
      </span>
      <span className="preserve-card-text">
        <span className="preserve-card-title">Preserve Panes</span>
        <span className="preserve-card-desc">
          Bring this workspace back after closing Glyph, re-running each pane's startup command to restore connections
          like ssh or docker exec.
        </span>
        <span className="preserve-card-status">{status}</span>
      </span>
      <span className="glyph-switch" aria-hidden="true">
        <span className="glyph-switch-thumb" />
      </span>
    </button>
  );
}
