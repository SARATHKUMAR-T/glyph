import { useEffect, useState } from "react";

import { TERMINAL_FONT_FAMILY } from "../../lib/constants";
import type { CursorStyleOption, MatrixSpeed, MatrixStyle, TerminalSettings } from "../../hooks/useTerminalSettings";
import {
  ACTION_LABELS,
  formatKeyCombo,
  type KeyCombo,
  type KeybindingsConfig,
  type ShortcutAction,
} from "../../hooks/useKeybindings";
import { CustomSelect } from "../ui/CustomSelect";

type SettingsProps = {
  open: boolean;
  settings: TerminalSettings;
  keybindings: KeybindingsConfig;
  onUpdateSettings: (patch: Partial<TerminalSettings>) => void;
  onUpdateKeybinding: (action: ShortcutAction, combo: KeyCombo) => void;
  onResetKeybindings: () => void;
};

const COLOR_SWATCHES = [
  { label: "Muted Grey", color: "#8c8c91" },
  { label: "Glyph Red", color: "#ff3030" },
  { label: "Matrix Green", color: "#00ff66" },
  { label: "Cyber Cyan", color: "#00e5ff" },
  { label: "Neon Purple", color: "#b840ff" },
  { label: "Amber Glow", color: "#ffb000" },
];

const PATTERN_OPTIONS: { label: string; value: MatrixStyle }[] = [
  { label: "Matrix Digital Rain", value: "matrix-rain" },
  { label: "Static Dot Grid", value: "static-grid" },
  { label: "Nothing OS Grid", value: "nothing-grid" },
];

const SPEED_OPTIONS: { label: string; value: MatrixSpeed }[] = [
  { label: "Slow", value: "slow" },
  { label: "Normal", value: "normal" },
  { label: "Fast", value: "fast" },
];

const CURSOR_OPTIONS: { label: string; value: CursorStyleOption }[] = [
  { label: "Glowing Bar", value: "bar" },
  { label: "Glyph Solid Block", value: "block" },
  { label: "Underline", value: "underline" },
];

const FONT_SIZE_OPTIONS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 28].map((s) => ({
  label: `${s}px`,
  value: s,
}));

export function Settings({
  open,
  settings,
  keybindings,
  onUpdateSettings,
  onUpdateKeybinding,
  onResetKeybindings,
}: SettingsProps) {
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null);

  useEffect(() => {
    if (!recordingAction) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      // Cancel on Escape key alone
      if (event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        setRecordingAction(null);
        return;
      }

      // Ignore lone modifier keys
      const key = event.key.toLowerCase();
      if (["control", "shift", "alt", "meta"].includes(key)) {
        return;
      }

      const newCombo: KeyCombo = {
        key: event.key.length === 1 ? event.key.toLowerCase() : event.code.replace(/^Key|^Digit/, "").toLowerCase(),
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
        meta: event.metaKey,
      };

      onUpdateKeybinding(recordingAction, newCombo);
      setRecordingAction(null);
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [onUpdateKeybinding, recordingAction]);

  return (
    <aside className={open ? "settings-panel is-open" : "settings-panel"} aria-hidden={!open}>
      <div className="settings-section">
        <div className="settings-header-row">
          <h2>Keyboard Shortcuts</h2>
          <button
            type="button"
            className="settings-reset-button"
            onClick={onResetKeybindings}
            title="Reset all shortcuts to defaults"
          >
            Reset Defaults
          </button>
        </div>

        {(Object.keys(ACTION_LABELS) as ShortcutAction[]).map((action) => {
          const info = ACTION_LABELS[action];
          const combo = keybindings[action];
          const isRecording = recordingAction === action;

          return (
            <div key={action} className="shortcut-setting-row">
              <div className="shortcut-info">
                <strong>{info.label}</strong>
                <small>{info.description}</small>
              </div>
              <div className="shortcut-action-group">
                <span className={isRecording ? "shortcut-badge is-recording" : "shortcut-badge"}>
                  {isRecording ? "Press keys..." : formatKeyCombo(combo)}
                </span>
                <button
                  type="button"
                  className={isRecording ? "shortcut-remap-btn is-active" : "shortcut-remap-btn"}
                  onClick={() => setRecordingAction(isRecording ? null : action)}
                >
                  {isRecording ? "Cancel" : "Remap"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="settings-section">
        <h2>Performance Monitor</h2>
        <div className="settings-row">
          <span>Show System Performance</span>
          <button
            type="button"
            className={settings.showPerformanceBar ? "settings-toggle is-active" : "settings-toggle"}
            onClick={() => onUpdateSettings({ showPerformanceBar: !settings.showPerformanceBar })}
          >
            {settings.showPerformanceBar ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      <div className="settings-section">
        <h2>Matrix Dot Background</h2>
        <div className="settings-row">
          <span>Pattern</span>
          <CustomSelect
            value={settings.matrixStyle}
            options={PATTERN_OPTIONS}
            onChange={(val) => onUpdateSettings({ matrixStyle: val })}
          />
        </div>

        <div className="settings-row">
          <span>Matrix Color</span>
          <div className="color-picker-group">
            <input
              type="color"
              className="settings-color-input"
              value={settings.dotColor}
              onChange={(e) => onUpdateSettings({ dotColor: e.target.value })}
              title="Custom Color Selector"
            />
            <span className="color-hex-label">{settings.dotColor.toUpperCase()}</span>
          </div>
        </div>

        <div className="settings-swatches-row">
          {COLOR_SWATCHES.map((swatch) => (
            <button
              key={swatch.color}
              type="button"
              className={settings.dotColor.toLowerCase() === swatch.color.toLowerCase() ? "color-swatch is-active" : "color-swatch"}
              style={{ backgroundColor: swatch.color }}
              title={swatch.label}
              onClick={() => onUpdateSettings({ dotColor: swatch.color })}
            />
          ))}
        </div>

        <div className="settings-row">
          <span>Speed</span>
          <CustomSelect
            value={settings.matrixSpeed}
            options={SPEED_OPTIONS}
            onChange={(val) => onUpdateSettings({ matrixSpeed: val })}
          />
        </div>

        <div className="settings-row">
          <span>Interactive Glow</span>
          <button
            type="button"
            className={settings.interactiveGlow ? "settings-toggle is-active" : "settings-toggle"}
            onClick={() => onUpdateSettings({ interactiveGlow: !settings.interactiveGlow })}
          >
            {settings.interactiveGlow ? "ON" : "OFF"}
          </button>
        </div>

        <div className="settings-row">
          <span>Dot Opacity</span>
          <input
            type="range"
            min="0.2"
            max="1.0"
            step="0.05"
            className="settings-range"
            value={settings.dotOpacity}
            onChange={(e) => onUpdateSettings({ dotOpacity: parseFloat(e.target.value) })}
          />
        </div>
      </div>

      <div className="settings-section">
        <h2>Glyph Cursor</h2>
        <div className="settings-row">
          <span>Style</span>
          <CustomSelect
            value={settings.cursorStyle}
            options={CURSOR_OPTIONS}
            onChange={(val) => onUpdateSettings({ cursorStyle: val })}
          />
        </div>
        <div className="settings-row">
          <span>Blink Animation</span>
          <button
            type="button"
            className={settings.cursorBlink ? "settings-toggle is-active" : "settings-toggle"}
            onClick={() => onUpdateSettings({ cursorBlink: !settings.cursorBlink })}
          >
            {settings.cursorBlink ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      <div className="settings-section">
        <h2>Type</h2>
        <div className="settings-row">
          <span>Font</span>
          <strong>{TERMINAL_FONT_FAMILY.split(",")[0].replaceAll('"', "")}</strong>
        </div>
        <div className="settings-row">
          <span>Size</span>
          <CustomSelect
            value={settings.fontSize || 14}
            options={FONT_SIZE_OPTIONS}
            onChange={(val) => onUpdateSettings({ fontSize: val })}
          />
        </div>
      </div>
    </aside>
  );
}
