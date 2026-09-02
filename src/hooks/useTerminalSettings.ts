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
};

const STORAGE_KEY = "glyph_terminal_settings_v8";

export function useTerminalSettings() {
  const [settings, setSettings] = useState<TerminalSettings>(() => {
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
  });

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
