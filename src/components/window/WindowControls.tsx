import { getCurrentWindow } from "@tauri-apps/api/window";

import { isTauriRuntime } from "../../lib/terminal/events";

async function runWindowAction(action: "minimize" | "toggleMaximize" | "close") {
  if (!isTauriRuntime()) {
    return;
  }

  const appWindow = getCurrentWindow();
  if (action === "minimize") {
    await appWindow.minimize();
    return;
  }

  if (action === "toggleMaximize") {
    await appWindow.toggleMaximize();
    return;
  }

  await appWindow.close();
}

export function WindowControls() {
  return (
    <div className="window-controls">
      <button
        aria-label="Minimize Window"
        className="window-control"
        title="Minimize Window"
        type="button"
        onClick={() => void runWindowAction("minimize")}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <button
        aria-label="Maximize or Restore Window"
        className="window-control"
        title="Maximize or Restore Window"
        type="button"
        onClick={() => void runWindowAction("toggleMaximize")}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="4" width="16" height="16" rx="2" />
        </svg>
      </button>
      <button
        aria-label="Close Window (Ctrl+Shift+W)"
        className="window-control window-control-danger"
        title="Close Window (Ctrl+Shift+W)"
        type="button"
        onClick={() => void runWindowAction("close")}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
