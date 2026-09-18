import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

import { getTheme, themeToEnginePalette, DEFAULT_THEME_ID } from "../lib/terminal/themes";
import type { ThemeId } from "../lib/terminal/themes";
import { isTauriRuntime } from "../lib/terminal/events";

/**
 * Applies the active theme's CSS custom properties to <html> so all CSS
 * that uses var(--glyph-*) — including the terminal grid renderer, which
 * reads them directly (see CanvasGridRenderer's `themeColor`) — picks up
 * the new values automatically. Also pushes the theme's ANSI palette to
 * every running terminal session (`engine_set_palette`), so program
 * output (`ls --color`, vim, etc.) recolors along with the rest of the
 * UI instead of staying on the engine's default "Nothing Dark" palette.
 */
export function useTerminalTheme(themeId: ThemeId = DEFAULT_THEME_ID): void {
  const theme = getTheme(themeId);

  useEffect(() => {
    const root = document.documentElement;
    const vars = theme.cssVars;

    // Apply every CSS custom property defined by the theme
    for (const [prop, value] of Object.entries(vars)) {
      root.style.setProperty(prop, value);
    }

    // Keep color-scheme in sync so browser chrome (scrollbars, inputs) matches
    root.style.colorScheme = vars["--glyph-color-scheme"];

    // Expose the theme id and category as data attributes for any CSS selectors that need it
    root.dataset.glyphTheme = themeId;
    root.dataset.glyphThemeCategory = theme.category;

    if (isTauriRuntime()) {
      void invoke("engine_set_palette", { palette: themeToEnginePalette(theme) }).catch((error: unknown) => {
        console.error("[useTerminalTheme] failed to push palette to the engine:", error);
      });
    }
  }, [theme, themeId]);
}

