import { useCallback, useEffect, useState } from "react";

export type MatrixStyle = "static-grid" | "nothing-grid" | "matrix-rain" | "red-pulse";
export type MatrixSpeed = "slow" | "normal" | "fast";
export type CursorStyleOption = "block" | "bar" | "underline";

export type TerminalSettings = {
  matrixStyle: MatrixStyle;
  matrixSpeed: MatrixSpeed;
  interactiveGlow: boolean;
  dotOpacity: number;
  dotColor: string;
  cursorStyle: CursorStyleOption;
  cursorBlink: boolean;
  fontSize: number;
};

const DEFAULT_SETTINGS: TerminalSettings = {
  matrixStyle: "matrix-rain",
  matrixSpeed: "normal",
  interactiveGlow: true,
  dotOpacity: 0.8,
  dotColor: "#00ff66",
  cursorStyle: "bar",
  cursorBlink: true,
  fontSize: 14,
};

const STORAGE_KEY = "glyph_terminal_settings_v6";

export function useTerminalSettings() {
  const [settings, setSettings] = useState<TerminalSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
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
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      // If switching to red-pulse pattern and color wasn't customized, default to vibrant Glyph Red #ff3030
      if (patch.matrixStyle === "red-pulse" && prev.dotColor === "#8c8c91") {
        next.dotColor = "#ff3030";
      }
      return next;
    });
  }, []);

  return {
    settings,
    updateSettings,
  };
}
