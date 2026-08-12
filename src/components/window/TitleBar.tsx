import { APP_NAME } from "../../lib/constants";
import { WindowControls } from "./WindowControls";

type TitleBarProps = {
  onNewTerminal: () => void;
  onSearch: () => void;
  onToggleSettings: () => void;
};

export function TitleBar({ onNewTerminal, onSearch, onToggleSettings }: TitleBarProps) {
  return (
    <header className="title-bar" data-tauri-drag-region>
      <div className="brand-lockup" data-tauri-drag-region>
        <span className="brand-pulse" aria-hidden="true" />
        <span className="brand-text">{APP_NAME}</span>
      </div>
      <div className="title-actions">
        <button
          aria-label="New Terminal Tab (Ctrl+Shift+T)"
          className="title-action"
          title="New Terminal Tab (Ctrl+Shift+T)"
          type="button"
          onClick={onNewTerminal}
        >
          +
        </button>
        <button
          aria-label="Search Buffer (Ctrl+Shift+F)"
          className="title-action"
          title="Search Buffer (Ctrl+Shift+F)"
          type="button"
          onClick={onSearch}
        >
          ⌕
        </button>
        <button
          aria-label="Settings (Ctrl+,)"
          className="title-action"
          title="Settings (Ctrl+,)"
          type="button"
          onClick={onToggleSettings}
        >
          ⚙
        </button>
        <WindowControls />
      </div>
    </header>
  );
}
