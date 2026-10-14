import { useEffect } from "react";

export type PendingKill = {
  kind: "pane" | "tab";
  /** Foreground program of each busy terminal ("" when unreadable). */
  processes: string[];
};

type ConfirmKillModalProps = {
  pending: PendingKill | null;
  onCancel: () => void;
  onConfirm: () => void;
};

/** Shown when a pane or tab is closed while one of its terminals still has
 * a program running — the per-pane/tab counterpart of `ConfirmCloseModal`.
 * Confirming kills the terminals along with what runs in them. */
export function ConfirmKillModal({ pending, onCancel, onConfirm }: ConfirmKillModalProps) {
  useEffect(() => {
    if (!pending) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [pending, onCancel]);

  if (!pending) return null;

  const { kind, processes } = pending;
  const names = processes.map((name) => name || "unknown process");
  const noun = kind === "pane" ? "pane" : "tab";

  return (
    <div className="workspace-modal-overlay" onClick={onCancel}>
      <div
        className="workspace-modal"
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="workspace-modal-header">
          <span className="workspace-modal-title">Close {noun}?</span>
        </div>
        <div className="workspace-modal-body">
          <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5 }}>
            {names.length === 1 ? "A process is" : `${names.length} processes are`} still running
            in this {noun}:
          </p>
          <ul style={{ margin: "8px 0", paddingLeft: "20px", fontSize: "13px", lineHeight: 1.5 }}>
            {names.map((name, i) => (
              <li key={i}>
                <code>{name}</code>
              </li>
            ))}
          </ul>
          <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5 }}>
            Closing the {noun} will kill {names.length === 1 ? "it" : "them"}.
          </p>
        </div>
        <div className="workspace-modal-footer">
          <button type="button" className="btn-glyph btn-glyph-secondary" autoFocus onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn-glyph btn-glyph-danger" onClick={onConfirm}>
            Close &amp; Kill
          </button>
        </div>
      </div>
    </div>
  );
}
