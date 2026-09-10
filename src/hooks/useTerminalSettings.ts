import { useCallback, useEffect, useState } from "react";
import type { ThemeId } from "../lib/terminal/themes";
import type { AIConfig } from "../lib/ai/types";
import { DEFAULT_AI_CONFIG } from "../lib/ai/config";
import { AIManager } from "../lib/ai/manager";

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
  ai: AIConfig;
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
  ai: DEFAULT_AI_CONFIG,
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
        const mergedAi = { ...DEFAULT_AI_CONFIG, ...(parsed.ai || {}) };
        const merged = { ...DEFAULT_SETTINGS, ...parsed, ai: mergedAi };
        AIManager.getInstance().updateConfig(merged.ai);
        return merged;
      }
    } catch {
      // Fall back to defaults
    }
    AIManager.getInstance().updateConfig(DEFAULT_SETTINGS.ai);
    return DEFAULT_SETTINGS;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Ignore storage write errors
    }
    AIManager.getInstance().updateConfig(settings.ai);
  }, [settings]);

  const updateSettings = useCallback((patch: Partial<TerminalSettings>) => {
    setSettings((prev) => {
      const updated = {
        ...prev,
        ...patch,
        ai: patch.ai ? { ...prev.ai, ...patch.ai } : prev.ai,
      };
      AIManager.getInstance().updateConfig(updated.ai);
      return updated;
    });
  }, []);

  return {
    settings,
    updateSettings,
  };
}

