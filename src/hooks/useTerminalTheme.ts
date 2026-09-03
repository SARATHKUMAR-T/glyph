import { useEffect } from "react";
import type { ITheme } from "@xterm/xterm";

import { getTheme, DEFAULT_THEME_ID } from "../lib/terminal/themes";
import type { ThemeId } from "../lib/terminal/themes";

/**
 * Applies the active theme's CSS custom properties to <html> (so all
 * CSS that uses var(--glyph-*) picks up the new values automatically)
 * and returns the xterm.js ITheme to pass to each terminal instance.
 */
export function useTerminalTheme(themeId: ThemeId = DEFAULT_THEME_ID): ITheme {
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
  }, [theme, themeId]);

  return theme.xtermTheme;
}

