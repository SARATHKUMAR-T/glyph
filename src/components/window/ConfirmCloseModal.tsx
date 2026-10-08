import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { isTauriRuntime } from "../../lib/terminal/events";

const CONFIRM_CLOSE_EVENT = "app://confirm-close";

/** Shown when the window is closed while terminals still have programs
 * running. The backend holds the close and emits the event; exiting kills
 * every terminal. */
export function ConfirmCloseModal() {
  const [running, setRunning] = useState<number | null>(null);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const unlisten = listen<number>(CONFIRM_CLOSE_EVENT, (event) => setRunning(event.payload));
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (running === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRunning(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [running]);

  if (running === null) return null;

  const cancel = () => setRunning(null);

  return (
    <div className="workspace-modal-overlay" onClick={cancel}>
      <div
        className="workspace-modal"
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="workspace-modal-header">
          <span className="workspace-modal-title">Exit Glyph?</span>
        </div>
        <div className="workspace-modal-body">
          <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5 }}>
            {running === 1 ? "A process is" : `${running} terminals have processes`} still
            running. Exiting will kill all terminals and stop them.
          </p>
        </div>
        <div className="workspace-modal-footer">
          <button type="button" className="btn-glyph btn-glyph-secondary" autoFocus onClick={cancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-glyph btn-glyph-danger"
            onClick={() => void invoke("quit_app")}
          >
            Exit &amp; Kill All
          </button>
        </div>
      </div>
    </div>
  );
}
