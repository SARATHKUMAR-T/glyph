import { useCallback, useEffect, useState } from "react";
import type { ThemeId } from "../lib/terminal/themes";

export type MatrixStyle = "static-grid" | "nothing-grid" | "matrix-rain";
export type MatrixSpeed = "slow" | "normal" | "fast";
export type CursorStyleOption = "block" | "bar" | "underline";

export type TerminalSettings = {
  themeId: ThemeId;
  matrixStyle: MatrixStyle;
  matrixSpeed: MatrixSpeed;
  interactiveGlow: boolean;
  dotOpacity: number;
  dotColor: string;
  cursorStyle: CursorStyleOption;
  cursorBlink: boolean;
  fontSize: number;
  showPerformanceBar: boolean;
  restoreTabsOnRestart: boolean;
};

const DEFAULT_SETTINGS: TerminalSettings = {
  themeId: "nothing-dark",
  matrixStyle: "matrix-rain",
  matrixSpeed: "normal",
  interactiveGlow: true,
  dotOpacity: 0.8,
  dotColor: "#8c8c91",
  cursorStyle: "bar",
  cursorBlink: true,
  fontSize: 14,
  showPerformanceBar: true,
  restoreTabsOnRestart: true,
};

const STORAGE_KEY = "glyph_terminal_settings_v8";

/** Reads the persisted settings synchronously from `localStorage`, outside
 * of React — used by `resolveInitialSession` in `main.tsx`, which runs
 * before the component tree (and this hook) exists, so it needs the same
 * "should I restore tabs" answer `useTerminalSettings` itself would give
 * without being able to call the hook. */
export function readStoredSettings(): TerminalSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<TerminalSettings>;
      // Migrate legacy matrixStyle value
      if ((parsed as Record<string, unknown>).matrixStyle === "red-pulse") {
        parsed.matrixStyle = "matrix-rain";
      }
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    // Fall back to defaults
  }
  return DEFAULT_SETTINGS;
}

export function useTerminalSettings() {
  const [settings, setSettings] = useState<TerminalSettings>(readStoredSettings);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Ignore storage write errors
    }
  }, [settings]);

  const updateSettings = useCallback((patch: Partial<TerminalSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  return {
    settings,
    updateSettings,
  };
}
