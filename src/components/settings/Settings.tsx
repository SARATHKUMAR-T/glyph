import { useEffect, useState, useMemo } from "react";

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
import { getAllThemes, getTheme } from "../../lib/terminal/themes";
import type { ThemeId } from "../../lib/terminal/themes";

type SettingsProps = {
  open: boolean;
  onClose?: () => void;
  settings: TerminalSettings;
  keybindings: KeybindingsConfig;
  onUpdateSettings: (patch: Partial<TerminalSettings>) => void;
  onUpdateKeybinding: (action: ShortcutAction, combo: KeyCombo) => void;
  onResetKeybindings: () => void;
};

type SettingsGroupKey = "themes" | "shortcuts" | "performance" | "matrix" | "cursor-font";

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

const CATEGORY_LABELS: Record<string, string> = {
  dark: "Dark",
  light: "Light",
  specialty: "Specialty",
};

const ALL_THEMES = getAllThemes();

export function Settings({
  open,
  onClose,
  settings,
  keybindings,
  onUpdateSettings,
  onUpdateKeybinding,
  onResetKeybindings,
}: SettingsProps) {
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<SettingsGroupKey>>(() => new Set(["themes"]));

  const activeTheme = useMemo(() => getTheme(settings.themeId), [settings.themeId]);
  const isLightTheme = activeTheme.category === "light";

  useEffect(() => {
    if (!recordingAction) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        setRecordingAction(null);
        return;
      }

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

  const groupedThemes = useMemo(() => {
    return ALL_THEMES.reduce<Record<string, typeof ALL_THEMES>>((acc, theme) => {
      if (!acc[theme.category]) acc[theme.category] = [];
      acc[theme.category].push(theme);
      return acc;
    }, {});
  }, []);

  const handleThemeSelect = (themeId: ThemeId) => {
    onUpdateSettings({ themeId });
  };

  const toggleGroup = (key: SettingsGroupKey) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <aside className={open ? "settings-panel is-open" : "settings-panel"} aria-hidden={!open}>
      {/* ── Top Header ───────────────────────────────────────── */}
      <div className="settings-header">
        <div className="settings-header-top">
          <div className="settings-panel-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <h2>Settings</h2>
          </div>
          <div className="settings-header-actions">
            <button
              type="button"
              className="settings-text-btn"
              onClick={() => {
                if (expandedGroups.size === 5) {
                  setExpandedGroups(new Set());
                } else {
                  setExpandedGroups(new Set(["themes", "shortcuts", "performance", "matrix", "cursor-font"]));
                }
              }}
              title="Toggle all sections"
            >
              {expandedGroups.size === 5 ? "Collapse All" : "Expand All"}
            </button>
            {onClose && (
              <button
                type="button"
                className="settings-close-btn"
                onClick={onClose}
                title="Close Settings (Esc)"
                aria-label="Close Settings"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── 1. Terminal Themes Group ─────────────────────────── */}
      <div className="settings-accordion-group">
        <button
          type="button"
          className={`settings-group-header ${expandedGroups.has("themes") ? "is-open" : ""}`}
          onClick={() => toggleGroup("themes")}
          aria-expanded={expandedGroups.has("themes")}
        >
          <div className="settings-group-header-left">
            <span className="settings-group-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
                <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
                <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
                <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
              </svg>
            </span>
            <div className="settings-group-title-wrap">
              <span className="settings-group-title">Terminal Themes</span>
              <span className="settings-group-desc">10 hand-crafted color schemes</span>
            </div>
          </div>
          <div className="settings-group-header-right">
            <span className="settings-group-badge">{activeTheme.name}</span>
            <svg className="settings-group-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </div>
        </button>

        {expandedGroups.has("themes") && (
          <div className="settings-group-content">
            {(["dark", "light", "specialty"] as const).map((cat) => {
              const group = groupedThemes[cat];
              if (!group?.length) return null;
              return (
                <div key={cat} className="theme-group">
                  <div className="theme-group-label">{CATEGORY_LABELS[cat]}</div>
                  <div className="theme-grid">
                    {group.map((theme) => {
                      const isActive = settings.themeId === theme.id;
                      return (
                        <button
                          key={theme.id}
                          type="button"
                          className={isActive ? "theme-card is-active" : "theme-card"}
                          onClick={() => handleThemeSelect(theme.id)}
                          title={theme.tagline}
                        >
                          <div className="theme-card-swatch">
                            {theme.preview.map((color, i) => (
                              <div
                                key={i}
                                className="theme-swatch-seg"
                                style={{ backgroundColor: color }}
                              />
                            ))}
                          </div>
                          <div className="theme-card-body">
                            <span className="theme-card-name">{theme.name}</span>
                            {isActive && <span className="theme-card-check">✓</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 2. Keyboard Shortcuts Group ─────────────────────── */}
      <div className="settings-accordion-group">
        <button
          type="button"
          className={`settings-group-header ${expandedGroups.has("shortcuts") ? "is-open" : ""}`}
          onClick={() => toggleGroup("shortcuts")}
          aria-expanded={expandedGroups.has("shortcuts")}
        >
            <div className="settings-group-header-left">
              <span className="settings-group-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="M6 8h.001M10 8h.001M14 8h.001M18 8h.001M8 12h.001M12 12h.001M16 12h.001M7 16h10" />
                </svg>
              </span>
              <div className="settings-group-title-wrap">
                <span className="settings-group-title">Keyboard Shortcuts</span>
                <span className="settings-group-desc">Hotkeys & custom bindings</span>
              </div>
            </div>
            <div className="settings-group-header-right">
              <span className="settings-group-badge">{Object.keys(ACTION_LABELS).length} shortcuts</span>
              <svg className="settings-group-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </div>
          </button>

          {expandedGroups.has("shortcuts") && (
            <div className="settings-group-content">
              <div className="settings-header-row">
                <span className="shortcut-section-subtitle">Terminal & Pane Actions</span>
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
          )}
        </div>

      {/* ── 3. Performance Monitor Group ─────────────────────── */}
      <div className="settings-accordion-group">
        <button
          type="button"
          className={`settings-group-header ${expandedGroups.has("performance") ? "is-open" : ""}`}
          onClick={() => toggleGroup("performance")}
          aria-expanded={expandedGroups.has("performance")}
        >
          <div className="settings-group-header-left">
            <span className="settings-group-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            </span>
            <div className="settings-group-title-wrap">
              <span className="settings-group-title">Performance Monitor</span>
              <span className="settings-group-desc">CPU, RAM & cache telemetry bar</span>
            </div>
          </div>
          <div className="settings-group-header-right">
            <span className="settings-group-badge">{settings.showPerformanceBar ? "ON" : "OFF"}</span>
            <svg className="settings-group-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </div>
        </button>

        {expandedGroups.has("performance") && (
          <div className="settings-group-content">
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
        )}
      </div>

      {/* ── 4. Matrix Dot Background Group ───────────────────── */}
      <div className="settings-accordion-group">
        <button
          type="button"
          className={`settings-group-header ${expandedGroups.has("matrix") ? "is-open" : ""}`}
          onClick={() => toggleGroup("matrix")}
          aria-expanded={expandedGroups.has("matrix")}
        >
            <div className="settings-group-header-left">
              <span className="settings-group-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
                </svg>
              </span>
              <div className="settings-group-title-wrap">
                <span className="settings-group-title">Matrix Dot Background</span>
                <span className="settings-group-desc">Canvas grid & digital rain animations</span>
              </div>
            </div>
            <div className="settings-group-header-right">
              <span className="settings-group-badge">
                {isLightTheme ? "Disabled (Light)" : settings.matrixStyle}
              </span>
              <svg className="settings-group-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </div>
          </button>

          {expandedGroups.has("matrix") && (
            <div className="settings-group-content">
              {/* Informational Callout regarding Light Themes - only shown when a light theme is active */}
              {isLightTheme && (
                <div className="matrix-theme-notice is-light-active">
                  <div className="matrix-notice-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="16" x2="12" y2="12" />
                      <line x1="12" y1="8" x2="12.01" y2="8" />
                    </svg>
                  </div>
                  <div className="matrix-notice-body">
                    <strong>Light Theme Notice:</strong>
                    <p>
                      Active theme &ldquo;{activeTheme.name}&rdquo; is a light theme. Matrix dot background animations are automatically disabled to ensure clean text contrast.
                    </p>
                  </div>
                </div>
              )}

              <div className={`matrix-controls ${isLightTheme ? "matrix-controls-dimmed" : ""}`}>
                <div className="settings-row">
                  <span>Pattern</span>
                  <CustomSelect
                    value={settings.matrixStyle}
                    options={PATTERN_OPTIONS}
                    onChange={(val) => onUpdateSettings({ matrixStyle: val })}
                  />
                </div>

                <div className="settings-row">
                  <span>Custom Color</span>
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

                <div className="settings-row swatches-row">
                  <span>Color Palette</span>
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
                  <div className="settings-range-wrap">
                    <input
                      type="range"
                      min="0.2"
                      max="1.0"
                      step="0.05"
                      className="settings-range"
                      value={settings.dotOpacity}
                      onChange={(e) => onUpdateSettings({ dotOpacity: parseFloat(e.target.value) })}
                    />
                    <span className="settings-range-val">{Math.round(settings.dotOpacity * 100)}%</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

      {/* ── 5. Cursor & Typography Group ─────────────────────── */}
      <div className="settings-accordion-group">
        <button
          type="button"
          className={`settings-group-header ${expandedGroups.has("cursor-font") ? "is-open" : ""}`}
          onClick={() => toggleGroup("cursor-font")}
          aria-expanded={expandedGroups.has("cursor-font")}
        >
          <div className="settings-group-header-left">
            <span className="settings-group-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 7 4 4 20 4 20 7" />
                <line x1="9" y1="20" x2="15" y2="20" />
                <line x1="12" y1="4" x2="12" y2="20" />
              </svg>
            </span>
            <div className="settings-group-title-wrap">
              <span className="settings-group-title">Cursor & Typography</span>
              <span className="settings-group-desc">Cursor shape, blink rate & font size</span>
            </div>
          </div>
          <div className="settings-group-header-right">
            <span className="settings-group-badge">{settings.cursorStyle} · {settings.fontSize}px</span>
            <svg className="settings-group-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </div>
        </button>

        {expandedGroups.has("cursor-font") && (
          <div className="settings-group-content">
            <div className="settings-row">
              <span>Cursor Style</span>
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
            <div className="settings-row">
              <span>Font Family</span>
              <strong>{TERMINAL_FONT_FAMILY.split(",")[0].replaceAll('"', "")}</strong>
            </div>
            <div className="settings-row">
              <span>Font Size</span>
              <CustomSelect
                value={settings.fontSize || 14}
                options={FONT_SIZE_OPTIONS}
                onChange={(val) => onUpdateSettings({ fontSize: val })}
              />
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
