// ─── Types ────────────────────────────────────────────────────────────────────

export type ThemeCategory = "dark" | "light" | "specialty";

export type GlyphCssVars = {
  /** App-shell background */
  "--glyph-bg": string;
  /** Page / html background (matches bg) */
  "--glyph-html-bg": string;
  /** Panel / title-bar surface */
  "--glyph-surface": string;
  /** Elevated surface (dropdowns, cards) */
  "--glyph-surface-raised": string;
  /** Primary foreground text */
  "--glyph-fg": string;
  /** Secondary / muted text */
  "--glyph-fg-muted": string;
  /** Accent colour — borders, cursor, scrollbar, glow */
  "--glyph-accent": string;
  /** Dimmed accent for hover states */
  "--glyph-accent-dim": string;
  /** Accent glow rgba string */
  "--glyph-accent-glow": string;
  /** Text-selection fill — noticeably stronger than `--glyph-accent-dim`
   * (which is tuned for subtle hover states, not a highlight you're meant
   * to read at a glance) since it's painted as a real background layer
   * behind the glyphs, the same way selection reads in a normal terminal
   * emulator (Alacritty, iTerm2, VS Code). */
  "--glyph-selection-bg": string;
  /** Search-match highlight background — a solid, high-contrast
   * "highlighter" color distinct from `--glyph-accent` (which many themes
   * already spend on the cursor/borders/glow), so a found match reads
   * unmistakably instead of blending into the rest of the UI's accent. */
  "--glyph-search-match": string;
  /** Ink color drawn over `--glyph-search-match` — chosen per theme for
   * contrast against that specific highlight color, not assumed. */
  "--glyph-search-match-fg": string;
  /** Primary border */
  "--glyph-line": string;
  /** Strong border */
  "--glyph-line-strong": string;
  /** Shadow color */
  "--glyph-shadow": string;
  /** Dot-matrix background radial gradient colour */
  "--glyph-dot-color": string;
  /** Dot-matrix background-image value */
  "--glyph-dot-pattern": string;
  /** Dot-matrix background-size */
  "--glyph-dot-size": string;
  /** color-scheme for browser chrome */
  "--glyph-color-scheme": string;
};

export type GlyphTheme = {
  id: ThemeId;
  name: string;
  category: ThemeCategory;
  /** Short label shown in the picker swatch */
  tagline: string;
  /** Representative swatch colors for the picker preview */
  preview: [string, string, string, string];
  /** Default matrix dot color for this theme */
  defaultDotColor: string;
  /** CSS custom property overrides applied to <html> */
  cssVars: GlyphCssVars;
  /** The 16 ANSI terminal colors (Black..BrightWhite), pushed to the Rust
   * grid engine via `engine_set_palette` so `ls --color`, vim, etc. follow
   * the active theme. Terminal foreground/cursor reuse `--glyph-fg`/
   * `--glyph-accent` above; terminal background stays transparent (so the
   * app's own background shows through) except for "light" category
   * themes, which use `--glyph-bg` opaque — see `themeToEnginePalette`. */
  ansi16: [
    string, string, string, string, string, string, string, string,
    string, string, string, string, string, string, string, string,
  ];
};

export type ThemeId =
  | "nothing-dark"
  | "tokyo-night"
  | "dracula"
  | "solarized-dark"
  | "one-dark"
  | "nord"
  | "catppuccin-mocha"
  | "solarized-light"
  | "github-light"
  | "paper";

// ─── Theme Definitions ────────────────────────────────────────────────────────

const themes: GlyphTheme[] = [
  // ── 1. Nothing Dark (Default) ────────────────────────────────────────────
  {
    id: "nothing-dark",
    name: "Nothing Dark",
    category: "dark",
    tagline: "Default · Red dot-matrix",
    preview: ["#040406", "#ff3030", "#f5f5f5", "#0d0d10"],
    defaultDotColor: "#8c8c91",
    cssVars: {
      "--glyph-bg": "#040406",
      "--glyph-html-bg": "#040406",
      "--glyph-surface": "#0d0d10",
      "--glyph-surface-raised": "#141414",
      "--glyph-fg": "#f5f5f5",
      "--glyph-fg-muted": "#b3b3b3",
      "--glyph-accent": "#ff3030",
      "--glyph-accent-dim": "rgba(255, 48, 48, 0.18)",
      "--glyph-accent-glow": "rgba(255, 48, 48, 0.45)",
      "--glyph-selection-bg": "rgba(255, 48, 48, 0.40)",
      "--glyph-search-match": "#ffcc00",
      "--glyph-search-match-fg": "#040406",
      "--glyph-line": "rgba(255, 255, 255, 0.12)",
      "--glyph-line-strong": "rgba(255, 255, 255, 0.22)",
      "--glyph-shadow": "rgba(0, 0, 0, 0.48)",
      "--glyph-dot-color": "rgba(140, 140, 145, 0.15)",
      "--glyph-dot-pattern": "radial-gradient(rgba(140, 140, 145, 0.15) 1.2px, transparent 1.2px)",
      "--glyph-dot-size": "20px 20px",
      "--glyph-color-scheme": "dark",
    },
    ansi16: ["#000000", "#d71921", "#b6f2bd", "#f3e7a1", "#9cc9ff", "#e4b2ff", "#9ee7e5", "#f5f5f5", "#777777", "#ff3030", "#d2ffd6", "#fff4b8", "#b8dcff", "#f0caff", "#c1fffb", "#ffffff"],
  },

  // ── 2. Tokyo Night ───────────────────────────────────────────────────────
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    category: "dark",
    tagline: "Deep navy · Purple accents",
    preview: ["#1a1b2e", "#7aa2f7", "#bb9af7", "#414868"],
    defaultDotColor: "#414868",
    cssVars: {
      "--glyph-bg": "#1a1b2e",
      "--glyph-html-bg": "#16161e",
      "--glyph-surface": "#1f2335",
      "--glyph-surface-raised": "#24283b",
      "--glyph-fg": "#c0caf5",
      "--glyph-fg-muted": "#9aa5ce",
      "--glyph-accent": "#7aa2f7",
      "--glyph-accent-dim": "rgba(122, 162, 247, 0.18)",
      "--glyph-accent-glow": "rgba(122, 162, 247, 0.4)",
      "--glyph-selection-bg": "rgba(122, 162, 247, 0.40)",
      "--glyph-search-match": "#e0af68",
      "--glyph-search-match-fg": "#16161e",
      "--glyph-line": "rgba(255, 255, 255, 0.08)",
      "--glyph-line-strong": "rgba(255, 255, 255, 0.16)",
      "--glyph-shadow": "rgba(0, 0, 0, 0.55)",
      "--glyph-dot-color": "rgba(65, 72, 104, 0.55)",
      "--glyph-dot-pattern": "radial-gradient(rgba(65, 72, 104, 0.55) 1.2px, transparent 1.2px)",
      "--glyph-dot-size": "20px 20px",
      "--glyph-color-scheme": "dark",
    },
    ansi16: ["#15161e", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#a9b1d6", "#414868", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#c0caf5"],
  },

  // ── 3. Dracula ───────────────────────────────────────────────────────────
  {
    id: "dracula",
    name: "Dracula",
    category: "dark",
    tagline: "Purple · Pink · Cyan",
    preview: ["#282a36", "#ff79c6", "#bd93f9", "#50fa7b"],
    defaultDotColor: "#44475a",
    cssVars: {
      "--glyph-bg": "#282a36",
      "--glyph-html-bg": "#21222c",
      "--glyph-surface": "#21222c",
      "--glyph-surface-raised": "#2d2f3f",
      "--glyph-fg": "#f8f8f2",
      "--glyph-fg-muted": "#6272a4",
      "--glyph-accent": "#ff79c6",
      "--glyph-accent-dim": "rgba(255, 121, 198, 0.18)",
      "--glyph-accent-glow": "rgba(255, 121, 198, 0.4)",
      "--glyph-selection-bg": "rgba(255, 121, 198, 0.40)",
      "--glyph-search-match": "#f1fa8c",
      "--glyph-search-match-fg": "#21222c",
      "--glyph-line": "rgba(255, 255, 255, 0.08)",
      "--glyph-line-strong": "rgba(255, 255, 255, 0.15)",
      "--glyph-shadow": "rgba(0, 0, 0, 0.5)",
      "--glyph-dot-color": "rgba(68, 71, 90, 0.7)",
      "--glyph-dot-pattern": "radial-gradient(rgba(68, 71, 90, 0.7) 1.2px, transparent 1.2px)",
      "--glyph-dot-size": "20px 20px",
      "--glyph-color-scheme": "dark",
    },
    ansi16: ["#21222c", "#ff5555", "#50fa7b", "#f1fa8c", "#bd93f9", "#ff79c6", "#8be9fd", "#f8f8f2", "#6272a4", "#ff6e6e", "#69ff94", "#ffffa5", "#d6acff", "#ff92df", "#a4ffff", "#ffffff"],
  },

  // ── 4. Solarized Dark ────────────────────────────────────────────────────
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    category: "dark",
    tagline: "Warm blue-grey · Balanced",
    preview: ["#002b36", "#268bd2", "#2aa198", "#839496"],
    defaultDotColor: "#073642",
    cssVars: {
      "--glyph-bg": "#002b36",
      "--glyph-html-bg": "#001e26",
      "--glyph-surface": "#073642",
      "--glyph-surface-raised": "#0d4555",
      "--glyph-fg": "#839496",
      "--glyph-fg-muted": "#657b83",
      "--glyph-accent": "#268bd2",
      "--glyph-accent-dim": "rgba(38, 139, 210, 0.18)",
      "--glyph-accent-glow": "rgba(38, 139, 210, 0.4)",
      "--glyph-selection-bg": "rgba(38, 139, 210, 0.40)",
      "--glyph-search-match": "#b58900",
      "--glyph-search-match-fg": "#002b36",
      "--glyph-line": "rgba(255, 255, 255, 0.08)",
      "--glyph-line-strong": "rgba(255, 255, 255, 0.14)",
      "--glyph-shadow": "rgba(0, 0, 0, 0.5)",
      "--glyph-dot-color": "rgba(7, 54, 66, 0.9)",
      "--glyph-dot-pattern": "radial-gradient(rgba(38, 139, 210, 0.12) 1.2px, transparent 1.2px)",
      "--glyph-dot-size": "20px 20px",
      "--glyph-color-scheme": "dark",
    },
    ansi16: ["#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5", "#002b36", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4", "#93a1a1", "#fdf6e3"],
  },

  // ── 5. One Dark ──────────────────────────────────────────────────────────
  {
    id: "one-dark",
    name: "One Dark",
    category: "dark",
    tagline: "Atom · Charcoal · Blue",
    preview: ["#282c34", "#61afef", "#c678dd", "#98c379"],
    defaultDotColor: "#3e4451",
    cssVars: {
      "--glyph-bg": "#282c34",
      "--glyph-html-bg": "#21252b",
      "--glyph-surface": "#21252b",
      "--glyph-surface-raised": "#2c313c",
      "--glyph-fg": "#abb2bf",
      "--glyph-fg-muted": "#5c6370",
      "--glyph-accent": "#61afef",
      "--glyph-accent-dim": "rgba(97, 175, 239, 0.18)",
      "--glyph-accent-glow": "rgba(97, 175, 239, 0.4)",
      "--glyph-selection-bg": "rgba(97, 175, 239, 0.40)",
      "--glyph-search-match": "#e5c07b",
      "--glyph-search-match-fg": "#21252b",
      "--glyph-line": "rgba(255, 255, 255, 0.08)",
      "--glyph-line-strong": "rgba(255, 255, 255, 0.14)",
      "--glyph-shadow": "rgba(0, 0, 0, 0.5)",
      "--glyph-dot-color": "rgba(62, 68, 81, 0.8)",
      "--glyph-dot-pattern": "radial-gradient(rgba(62, 68, 81, 0.8) 1.2px, transparent 1.2px)",
      "--glyph-dot-size": "20px 20px",
      "--glyph-color-scheme": "dark",
    },
    ansi16: ["#282c34", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#abb2bf", "#5c6370", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#ffffff"],
  },

  // ── 6. Nord ──────────────────────────────────────────────────────────────
  {
    id: "nord",
    name: "Nord",
    category: "dark",
    tagline: "Arctic · Blue-grey cool",
    preview: ["#2e3440", "#88c0d0", "#81a1c1", "#5e81ac"],
    defaultDotColor: "#3b4252",
    cssVars: {
      "--glyph-bg": "#2e3440",
      "--glyph-html-bg": "#242933",
      "--glyph-surface": "#3b4252",
      "--glyph-surface-raised": "#434c5e",
      "--glyph-fg": "#d8dee9",
      "--glyph-fg-muted": "#81a1c1",
      "--glyph-accent": "#88c0d0",
      "--glyph-accent-dim": "rgba(136, 192, 208, 0.18)",
      "--glyph-accent-glow": "rgba(136, 192, 208, 0.4)",
      "--glyph-selection-bg": "rgba(136, 192, 208, 0.40)",
      "--glyph-search-match": "#ebcb8b",
      "--glyph-search-match-fg": "#2e3440",
      "--glyph-line": "rgba(255, 255, 255, 0.08)",
      "--glyph-line-strong": "rgba(255, 255, 255, 0.14)",
      "--glyph-shadow": "rgba(0, 0, 0, 0.45)",
      "--glyph-dot-color": "rgba(59, 66, 82, 0.9)",
      "--glyph-dot-pattern": "radial-gradient(rgba(136, 192, 208, 0.1) 1.2px, transparent 1.2px)",
      "--glyph-dot-size": "20px 20px",
      "--glyph-color-scheme": "dark",
    },
    ansi16: ["#3b4252", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#88c0d0", "#e5e9f0", "#4c566a", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#8fbcbb", "#eceff4"],
  },

  // ── 7. Catppuccin Mocha ──────────────────────────────────────────────────
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    category: "specialty",
    tagline: "Warm mauve · Pastel palette",
    preview: ["#1e1e2e", "#cba6f7", "#89b4fa", "#a6e3a1"],
    defaultDotColor: "#313244",
    cssVars: {
      "--glyph-bg": "#1e1e2e",
      "--glyph-html-bg": "#181825",
      "--glyph-surface": "#181825",
      "--glyph-surface-raised": "#313244",
      "--glyph-fg": "#cdd6f4",
      "--glyph-fg-muted": "#a6adc8",
      "--glyph-accent": "#cba6f7",
      "--glyph-accent-dim": "rgba(203, 166, 247, 0.18)",
      "--glyph-accent-glow": "rgba(203, 166, 247, 0.4)",
      "--glyph-selection-bg": "rgba(203, 166, 247, 0.40)",
      "--glyph-search-match": "#f9e2af",
      "--glyph-search-match-fg": "#181825",
      "--glyph-line": "rgba(255, 255, 255, 0.07)",
      "--glyph-line-strong": "rgba(255, 255, 255, 0.13)",
      "--glyph-shadow": "rgba(0, 0, 0, 0.5)",
      "--glyph-dot-color": "rgba(49, 50, 68, 0.9)",
      "--glyph-dot-pattern": "radial-gradient(rgba(203, 166, 247, 0.1) 1.2px, transparent 1.2px)",
      "--glyph-dot-size": "20px 20px",
      "--glyph-color-scheme": "dark",
    },
    ansi16: ["#45475a", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#cba6f7", "#89dceb", "#bac2de", "#585b70", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#cba6f7", "#89dceb", "#a6adc8"],
  },

  // ── 8. Solarized Light ───────────────────────────────────────────────────
  {
    id: "solarized-light",
    name: "Solarized Light",
    category: "light",
    tagline: "Cream · Warm ink",
    preview: ["#fdf6e3", "#268bd2", "#2aa198", "#657b83"],
    defaultDotColor: "#eee8d5",
    cssVars: {
      "--glyph-bg": "#fdf6e3",
      "--glyph-html-bg": "#fdf6e3",
      "--glyph-surface": "#eee8d5",
      "--glyph-surface-raised": "#e8e2cf",
      "--glyph-fg": "#657b83",
      "--glyph-fg-muted": "#839496",
      "--glyph-accent": "#268bd2",
      "--glyph-accent-dim": "rgba(38, 139, 210, 0.14)",
      "--glyph-accent-glow": "rgba(38, 139, 210, 0.3)",
      "--glyph-selection-bg": "rgba(38, 139, 210, 0.30)",
      "--glyph-search-match": "#f5d76e",
      "--glyph-search-match-fg": "#002b36",
      "--glyph-line": "rgba(0, 0, 0, 0.1)",
      "--glyph-line-strong": "rgba(0, 0, 0, 0.18)",
      "--glyph-shadow": "rgba(0, 0, 0, 0.12)",
      "--glyph-dot-color": "transparent",
      "--glyph-dot-pattern": "none",
      "--glyph-dot-size": "20px 20px",
      "--glyph-color-scheme": "light",
    },
    ansi16: ["#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5", "#002b36", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4", "#93a1a1", "#fdf6e3"],
  },

  // ── 9. GitHub Light ──────────────────────────────────────────────────────
  {
    id: "github-light",
    name: "GitHub Light",
    category: "light",
    tagline: "Clean white · Blue ink",
    preview: ["#ffffff", "#0969da", "#1a7f37", "#cf222e"],
    defaultDotColor: "#d0d7de",
    cssVars: {
      "--glyph-bg": "#ffffff",
      "--glyph-html-bg": "#f6f8fa",
      "--glyph-surface": "#f6f8fa",
      "--glyph-surface-raised": "#eaeef2",
      "--glyph-fg": "#1f2328",
      "--glyph-fg-muted": "#57606a",
      "--glyph-accent": "#0969da",
      "--glyph-accent-dim": "rgba(9, 105, 218, 0.12)",
      "--glyph-accent-glow": "rgba(9, 105, 218, 0.25)",
      "--glyph-selection-bg": "rgba(9, 105, 218, 0.28)",
      "--glyph-search-match": "#fff8c5",
      "--glyph-search-match-fg": "#1f2328",
      "--glyph-line": "rgba(0, 0, 0, 0.1)",
      "--glyph-line-strong": "rgba(0, 0, 0, 0.18)",
      "--glyph-shadow": "rgba(0, 0, 0, 0.1)",
      "--glyph-dot-color": "transparent",
      "--glyph-dot-pattern": "none",
      "--glyph-dot-size": "20px 20px",
      "--glyph-color-scheme": "light",
    },
    ansi16: ["#24292f", "#cf222e", "#1a7f37", "#9a6700", "#0969da", "#8250df", "#0598bc", "#6e7781", "#57606a", "#a40e26", "#116329", "#7d4e00", "#0550ae", "#6639ba", "#0a69a2", "#8c959f"],
  },

  // ── 10. Paper ────────────────────────────────────────────────────────────
  {
    id: "paper",
    name: "Paper",
    category: "light",
    tagline: "Soft off-white · Ink black",
    preview: ["#f2efe4", "#2a4d6e", "#8b5e3c", "#4a7c59"],
    defaultDotColor: "#ddd8ca",
    cssVars: {
      "--glyph-bg": "#f2efe4",
      "--glyph-html-bg": "#ece9dd",
      "--glyph-surface": "#e8e5d9",
      "--glyph-surface-raised": "#ddd8ca",
      "--glyph-fg": "#1c1c1c",
      "--glyph-fg-muted": "#5a5a5a",
      "--glyph-accent": "#2a4d6e",
      "--glyph-accent-dim": "rgba(42, 77, 110, 0.12)",
      "--glyph-accent-glow": "rgba(42, 77, 110, 0.25)",
      "--glyph-selection-bg": "rgba(42, 77, 110, 0.30)",
      "--glyph-search-match": "#f0d78c",
      "--glyph-search-match-fg": "#1c1c1c",
      "--glyph-line": "rgba(0, 0, 0, 0.09)",
      "--glyph-line-strong": "rgba(0, 0, 0, 0.16)",
      "--glyph-shadow": "rgba(0, 0, 0, 0.1)",
      "--glyph-dot-color": "transparent",
      "--glyph-dot-pattern": "none",
      "--glyph-dot-size": "20px 20px",
      "--glyph-color-scheme": "light",
    },
    ansi16: ["#1c1c1c", "#b94040", "#4a7c59", "#8b6914", "#2a4d6e", "#7b4f82", "#2a6d6e", "#5a5a5a", "#3d3d3d", "#c95050", "#5a8c69", "#9b7924", "#3a5d7e", "#8b5f92", "#3a7d7e", "#888888"],
  },
];

// ─── Registry helpers ─────────────────────────────────────────────────────────

const themeMap = new Map<ThemeId, GlyphTheme>(themes.map((t) => [t.id, t]));

export function getAllThemes(): GlyphTheme[] {
  return themes;
}

export function getTheme(id: ThemeId): GlyphTheme {
  return themeMap.get(id) ?? themeMap.get("nothing-dark")!;
}

export const DEFAULT_THEME_ID: ThemeId = "nothing-dark";

/** Matches the Rust `ThemePalette` struct's wire shape exactly (see
 * `src-tauri/src/terminal/engine/palette.rs`) — passed straight through
 * as the `palette` argument to the `engine_set_palette` command. */
export type EnginePalette = {
  ansi16: Array<[number, number, number]>;
  foreground: [number, number, number];
  background: [number, number, number] | null;
  cursor: [number, number, number];
};

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

/** Converts a theme to the color payload the Rust grid engine needs —
 * see `ansi16`'s doc comment on `GlyphTheme` for why background is only
 * ever non-null for "light" category themes. */
export function themeToEnginePalette(theme: GlyphTheme): EnginePalette {
  return {
    ansi16: theme.ansi16.map(hexToRgb),
    foreground: hexToRgb(theme.cssVars["--glyph-fg"]),
    background: theme.category === "light" ? hexToRgb(theme.cssVars["--glyph-bg"]) : null,
    cursor: hexToRgb(theme.cssVars["--glyph-accent"]),
  };
}

