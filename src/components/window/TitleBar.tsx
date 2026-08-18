import { APP_NAME } from "../../lib/constants";
import { WindowControls } from "./WindowControls";
import { PerformanceBar } from "../ui/PerformanceBar";

type TitleBarProps = {
  onNewTerminal?: () => void;
  onNewWindow?: () => void;
  onSearch: () => void;
  onToggleSettings: () => void;
  showPerformanceBar?: boolean;
};

export function TitleBar({
  onNewTerminal,
  onNewWindow,
  onSearch,
  onToggleSettings,
  showPerformanceBar = true,
}: TitleBarProps) {
  return (
    <header className="title-bar-container" data-tauri-drag-region>
      <div className="title-bar" data-tauri-drag-region>
        <div className="title-bar-left" data-tauri-drag-region>
          <div className="brand-lockup" data-tauri-drag-region>
            <span className="brand-pulse" aria-hidden="true" />
            <span className="brand-text">{APP_NAME}</span>
          </div>
          <div className="perf-bar-desktop" data-tauri-drag-region>
            <PerformanceBar enabled={showPerformanceBar} />
          </div>
        </div>
        <div className="title-actions">
        {onNewWindow && (
          <button
            aria-label="New Terminal Window (Ctrl+Shift+N)"
            className="title-action"
            title="New Terminal Window (Ctrl+Shift+N)"
            type="button"
            onClick={onNewWindow}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        )}
        <button
          aria-label="Search Buffer (Ctrl+Shift+F)"
          className="title-action"
          title="Search Buffer (Ctrl+Shift+F)"
          type="button"
          onClick={onSearch}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
        <button
          aria-label="Settings (Ctrl+,)"
          className="title-action"
          title="Settings (Ctrl+,)"
          type="button"
          onClick={onToggleSettings}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <WindowControls />
        </div>
      </div>
      {showPerformanceBar && (
        <div className="perf-bar-mobile" data-tauri-drag-region>
          <PerformanceBar enabled={showPerformanceBar} />
        </div>
      )}
    </header>
  );
}
