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
        -
      </button>
      <button
        aria-label="Maximize or Restore Window"
        className="window-control"
        title="Maximize or Restore Window"
        type="button"
        onClick={() => void runWindowAction("toggleMaximize")}
      >
        □
      </button>
      <button
        aria-label="Close Window (Ctrl+Shift+W)"
        className="window-control window-control-danger"
        title="Close Window (Ctrl+Shift+W)"
        type="button"
        onClick={() => void runWindowAction("close")}
      >
        ×
      </button>
    </div>
  );
}
