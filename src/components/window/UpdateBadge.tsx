import type { UpdateInfo } from "../../lib/update/types";

type UpdateBadgeProps = {
  update: UpdateInfo;
  onApply: () => void;
  onDismiss: () => void;
};

/**
 * Pill shown in the title bar once a newer GitHub release is detected.
 * Clicking it doesn't update anything by itself — it hands the update
 * command to the active terminal for the user to review and run with
 * their own Enter key press (see App.tsx's `handleApplyUpdate`).
 */
export function UpdateBadge({ update, onApply, onDismiss }: UpdateBadgeProps) {
  return (
    <div className="update-badge" data-tauri-drag-region={false}>
      <button
        type="button"
        className="update-badge-action"
        title={`Glyph v${update.version} is available. Click to insert the update command in the active terminal.`}
        onClick={onApply}
      >
        <span className="update-badge-dot" aria-hidden="true" />
        Update to v{update.version}
      </button>
      <button
        type="button"
        className="update-badge-dismiss"
        aria-label="Dismiss update notice"
        title="Dismiss until the next release"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
