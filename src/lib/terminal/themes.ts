import type { ITheme } from "@xterm/xterm";

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
  /** Full xterm.js ITheme palette */
  xtermTheme: ITheme;
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
      "--glyph-line": "rgba(255, 255, 255, 0.12)",
      "--glyph-line-strong": "rgba(255, 255, 255, 0.22)",
      "--glyph-shadow": "rgba(0, 0, 0, 0.48)",
      "--glyph-dot-color": "rgba(140, 140, 145, 0.15)",
      "--glyph-dot-pattern": "radial-gradient(rgba(140, 140, 145, 0.15) 1.2px, transparent 1.2px)",
      "--glyph-dot-size": "20px 20px",
      "--glyph-color-scheme": "dark",
    },
    xtermTheme: {
      background: "#00000000",
      foreground: "#f5f5f5",
      cursor: "#ff3030",
      cursorAccent: "#000000",
      selectionBackground: "rgba(255, 48, 48, 0.35)",
      black: "#000000",
      red: "#d71921",
      green: "#b6f2bd",
      yellow: "#f3e7a1",
      blue: "#9cc9ff",
      magenta: "#e4b2ff",
      cyan: "#9ee7e5",
      white: "#f5f5f5",
      brightBlack: "#777777",
      brightRed: "#ff3030",
      brightGreen: "#d2ffd6",
      brightYellow: "#fff4b8",
      brightBlue: "#b8dcff",
      brightMagenta: "#f0caff",
      brightCyan: "#c1fffb",
      brightWhite: "#ffffff",
    },
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
      "--glyph-line": "rgba(255, 255, 255, 0.08)",
      "--glyph-line-strong": "rgba(255, 255, 255, 0.16)",
      "--glyph-shadow": "rgba(0, 0, 0, 0.55)",
      "--glyph-dot-color": "rgba(65, 72, 104, 0.55)",
      "--glyph-dot-pattern": "radial-gradient(rgba(65, 72, 104, 0.55) 1.2px, transparent 1.2px)",
      "--glyph-dot-size": "20px 20px",
      "--glyph-color-scheme": "dark",
    },
    xtermTheme: {
      background: "#00000000",
      foreground: "#c0caf5",
      cursor: "#7aa2f7",
      cursorAccent: "#1a1b2e",
      selectionBackground: "rgba(122, 162, 247, 0.3)",
      black: "#15161e",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
      brightBlack: "#414868",
      brightRed: "#f7768e",
      brightGreen: "#9ece6a",
      brightYellow: "#e0af68",
      brightBlue: "#7aa2f7",
      brightMagenta: "#bb9af7",
      brightCyan: "#7dcfff",
      brightWhite: "#c0caf5",
    },
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
      "--glyph-line": "rgba(255, 255, 255, 0.08)",
      "--glyph-line-strong": "rgba(255, 255, 255, 0.15)",
      "--glyph-shadow": "rgba(0, 0, 0, 0.5)",
      "--glyph-dot-color": "rgba(68, 71, 90, 0.7)",
      "--glyph-dot-pattern": "radial-gradient(rgba(68, 71, 90, 0.7) 1.2px, transparent 1.2px)",
      "--glyph-dot-size": "20px 20px",
      "--glyph-color-scheme": "dark",
    },
    xtermTheme: {
      background: "#00000000",
      foreground: "#f8f8f2",
      cursor: "#ff79c6",
      cursorAccent: "#282a36",
      selectionBackground: "rgba(189, 147, 249, 0.3)",
      black: "#21222c",
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#bd93f9",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#f8f8f2",
      brightBlack: "#6272a4",
      brightRed: "#ff6e6e",
      brightGreen: "#69ff94",
      brightYellow: "#ffffa5",
      brightBlue: "#d6acff",
      brightMagenta: "#ff92df",
      brightCyan: "#a4ffff",
      brightWhite: "#ffffff",
    },
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
      "--glyph-line": "rgba(255, 255, 255, 0.08)",
      "--glyph-line-strong": "rgba(255, 255, 255, 0.14)",
      "--glyph-shadow": "rgba(0, 0, 0, 0.5)",
      "--glyph-dot-color": "rgba(7, 54, 66, 0.9)",
      "--glyph-dot-pattern": "radial-gradient(rgba(38, 139, 210, 0.12) 1.2px, transparent 1.2px)",
      "--glyph-dot-size": "20px 20px",
      "--glyph-color-scheme": "dark",
    },
    xtermTheme: {
      background: "#00000000",
      foreground: "#839496",
      cursor: "#268bd2",
      cursorAccent: "#002b36",
      selectionBackground: "rgba(38, 139, 210, 0.3)",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#002b36",
      brightRed: "#cb4b16",
      brightGreen: "#586e75",
      brightYellow: "#657b83",
      brightBlue: "#839496",
      brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1",
      brightWhite: "#fdf6e3",
    },
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
      "--glyph-line": "rgba(255, 255, 255, 0.08)",
      "--glyph-line-strong": "rgba(255, 255, 255, 0.14)",
      "--glyph-shadow": "rgba(0, 0, 0, 0.5)",
      "--glyph-dot-color": "rgba(62, 68, 81, 0.8)",
      "--glyph-dot-pattern": "radial-gradient(rgba(62, 68, 81, 0.8) 1.2px, transparent 1.2px)",
      "--glyph-dot-size": "20px 20px",
      "--glyph-color-scheme": "dark",
    },
    xtermTheme: {
      background: "#00000000",
      foreground: "#abb2bf",
      cursor: "#61afef",
      cursorAccent: "#282c34",
      selectionBackground: "rgba(97, 175, 239, 0.3)",
      black: "#282c34",
      red: "#e06c75",
      green: "#98c379",
      yellow: "#e5c07b",
      blue: "#61afef",
      magenta: "#c678dd",
      cyan: "#56b6c2",
      white: "#abb2bf",
      brightBlack: "#5c6370",
      brightRed: "#e06c75",
      brightGreen: "#98c379",
      brightYellow: "#e5c07b",
      brightBlue: "#61afef",
      brightMagenta: "#c678dd",
      brightCyan: "#56b6c2",
      brightWhite: "#ffffff",
    },
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
      "--glyph-line": "rgba(255, 255, 255, 0.08)",
      "--glyph-line-strong": "rgba(255, 255, 255, 0.14)",
      "--glyph-shadow": "rgba(0, 0, 0, 0.45)",
      "--glyph-dot-color": "rgba(59, 66, 82, 0.9)",
      "--glyph-dot-pattern": "radial-gradient(rgba(136, 192, 208, 0.1) 1.2px, transparent 1.2px)",
      "--glyph-dot-size": "20px 20px",
      "--glyph-color-scheme": "dark",
    },
    xtermTheme: {
      background: "#00000000",
      foreground: "#d8dee9",
      cursor: "#88c0d0",
      cursorAccent: "#2e3440",
      selectionBackground: "rgba(136, 192, 208, 0.3)",
      black: "#3b4252",
      red: "#bf616a",
      green: "#a3be8c",
      yellow: "#ebcb8b",
      blue: "#81a1c1",
      magenta: "#b48ead",
      cyan: "#88c0d0",
      white: "#e5e9f0",
      brightBlack: "#4c566a",
      brightRed: "#bf616a",
      brightGreen: "#a3be8c",
      brightYellow: "#ebcb8b",
      brightBlue: "#81a1c1",
      brightMagenta: "#b48ead",
      brightCyan: "#8fbcbb",
      brightWhite: "#eceff4",
    },
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
      "--glyph-line": "rgba(255, 255, 255, 0.07)",
      "--glyph-line-strong": "rgba(255, 255, 255, 0.13)",
      "--glyph-shadow": "rgba(0, 0, 0, 0.5)",
      "--glyph-dot-color": "rgba(49, 50, 68, 0.9)",
      "--glyph-dot-pattern": "radial-gradient(rgba(203, 166, 247, 0.1) 1.2px, transparent 1.2px)",
      "--glyph-dot-size": "20px 20px",
      "--glyph-color-scheme": "dark",
    },
    xtermTheme: {
      background: "#00000000",
      foreground: "#cdd6f4",
      cursor: "#cba6f7",
      cursorAccent: "#1e1e2e",
      selectionBackground: "rgba(203, 166, 247, 0.3)",
      black: "#45475a",
      red: "#f38ba8",
      green: "#a6e3a1",
      yellow: "#f9e2af",
      blue: "#89b4fa",
      magenta: "#cba6f7",
      cyan: "#89dceb",
      white: "#bac2de",
      brightBlack: "#585b70",
      brightRed: "#f38ba8",
      brightGreen: "#a6e3a1",
      brightYellow: "#f9e2af",
      brightBlue: "#89b4fa",
      brightMagenta: "#cba6f7",
      brightCyan: "#89dceb",
      brightWhite: "#a6adc8",
    },
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
      "--glyph-line": "rgba(0, 0, 0, 0.1)",
      "--glyph-line-strong": "rgba(0, 0, 0, 0.18)",
      "--glyph-shadow": "rgba(0, 0, 0, 0.12)",
      "--glyph-dot-color": "transparent",
      "--glyph-dot-pattern": "none",
      "--glyph-dot-size": "20px 20px",
      "--glyph-color-scheme": "light",
    },
    xtermTheme: {
      background: "#fdf6e3",
      foreground: "#657b83",
      cursor: "#268bd2",
      cursorAccent: "#fdf6e3",
      selectionBackground: "rgba(38, 139, 210, 0.25)",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#002b36",
      brightRed: "#cb4b16",
      brightGreen: "#586e75",
      brightYellow: "#657b83",
      brightBlue: "#839496",
      brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1",
      brightWhite: "#fdf6e3",
    },
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
      "--glyph-line": "rgba(0, 0, 0, 0.1)",
      "--glyph-line-strong": "rgba(0, 0, 0, 0.18)",
      "--glyph-shadow": "rgba(0, 0, 0, 0.1)",
      "--glyph-dot-color": "transparent",
      "--glyph-dot-pattern": "none",
      "--glyph-dot-size": "20px 20px",
      "--glyph-color-scheme": "light",
    },
    xtermTheme: {
      background: "#ffffff",
      foreground: "#1f2328",
      cursor: "#0969da",
      cursorAccent: "#ffffff",
      selectionBackground: "rgba(9, 105, 218, 0.2)",
      black: "#24292f",
      red: "#cf222e",
      green: "#1a7f37",
      yellow: "#9a6700",
      blue: "#0969da",
      magenta: "#8250df",
      cyan: "#0598bc",
      white: "#6e7781",
      brightBlack: "#57606a",
      brightRed: "#a40e26",
      brightGreen: "#116329",
      brightYellow: "#7d4e00",
      brightBlue: "#0550ae",
      brightMagenta: "#6639ba",
      brightCyan: "#0a69a2",
      brightWhite: "#8c959f",
    },
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
      "--glyph-line": "rgba(0, 0, 0, 0.09)",
      "--glyph-line-strong": "rgba(0, 0, 0, 0.16)",
      "--glyph-shadow": "rgba(0, 0, 0, 0.1)",
      "--glyph-dot-color": "transparent",
      "--glyph-dot-pattern": "none",
      "--glyph-dot-size": "20px 20px",
      "--glyph-color-scheme": "light",
    },
    xtermTheme: {
      background: "#f2efe4",
      foreground: "#1c1c1c",
      cursor: "#2a4d6e",
      cursorAccent: "#f2efe4",
      selectionBackground: "rgba(42, 77, 110, 0.2)",
      black: "#1c1c1c",
      red: "#b94040",
      green: "#4a7c59",
      yellow: "#8b6914",
      blue: "#2a4d6e",
      magenta: "#7b4f82",
      cyan: "#2a6d6e",
      white: "#5a5a5a",
      brightBlack: "#3d3d3d",
      brightRed: "#c95050",
      brightGreen: "#5a8c69",
      brightYellow: "#9b7924",
      brightBlue: "#3a5d7e",
      brightMagenta: "#8b5f92",
      brightCyan: "#3a7d7e",
      brightWhite: "#888888",
    },
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

