/**
 * Guarantees selected text stays legible regardless of what color it
 * happened to be drawn in.
 *
 * A selection highlight is a translucent tint painted over whatever the
 * cell's own background was — unlike a theme's normal fg/bg pair (chosen
 * together, deliberately), that combination was never designed with each
 * other in mind. A theme's own default foreground (Solarized Light's
 * muted blue-grey, tuned for its cream background specifically) or an
 * ANSI color meant for a dark terminal (bright green/yellow/cyan read
 * fine on black, not on white) can end up with almost no contrast against
 * a light theme's selection tint even though the exact same text reads
 * fine unselected. This is the same class of problem terminals like
 * iTerm2 ship a "minimum contrast" setting for.
 *
 * Rather than hand-tune each theme's selection color (which would only
 * ever cover the default-text case, not arbitrary ANSI colors a shell
 * happens to print), both grid renderers call `pickReadableColor` per
 * selected cell: keep the cell's own color when it already contrasts
 * enough against the actual composited selection background, otherwise
 * fall back to plain black or white — whichever contrasts more.
 *
 * All colors here are normalized `0-1` float channels (straight alpha),
 * matching what the WebGL2 renderer already works in natively; the
 * Canvas2D renderer converts to/from its CSS color strings at the edges
 * via `parseCssColorToFloat`/`rgbaToCss`.
 */

const MIN_CONTRAST = 3; // WCAG "large text" minimum; terminal glyph strokes are bold/thick enough to qualify.

export type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];

function srgbToLinear(channel: number): number {
  return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance (0-1) of an opaque sRGB color. */
export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG contrast ratio (1-21) between two opaque sRGB colors. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function compositeOver([r, g, b, a]: Rgba, bg: Rgb): Rgb {
  return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];
}

/**
 * Returns `fg` unchanged if it already contrasts enough against
 * `selectionBg` composited over `cellBg`; otherwise returns opaque black
 * or white (keeping `fg`'s own alpha), whichever contrasts more.
 */
export function pickReadableColor(fg: Rgba, cellBg: Rgb, selectionBg: Rgba): Rgba {
  const compositedBg = compositeOver(selectionBg, cellBg);
  if (contrastRatio([fg[0], fg[1], fg[2]], compositedBg) >= MIN_CONTRAST) return fg;

  const blackContrast = contrastRatio([0, 0, 0], compositedBg);
  const whiteContrast = contrastRatio([1, 1, 1], compositedBg);
  return blackContrast >= whiteContrast ? [0, 0, 0, fg[3]] : [1, 1, 1, fg[3]];
}

/** Parses `#rgb`, `#rrggbb`, `rgb(...)`, or `rgba(...)` into normalized 0-1 channels. */
export function parseCssColorToFloat(css: string): Rgba {
  const rgbaMatch = css.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (rgbaMatch) {
    return [
      Number(rgbaMatch[1]) / 255,
      Number(rgbaMatch[2]) / 255,
      Number(rgbaMatch[3]) / 255,
      rgbaMatch[4] !== undefined ? Number(rgbaMatch[4]) : 1,
    ];
  }
  let hex = css.trim().replace("#", "");
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return [
    (parseInt(hex.slice(0, 2), 16) || 0) / 255,
    (parseInt(hex.slice(2, 4), 16) || 0) / 255,
    (parseInt(hex.slice(4, 6), 16) || 0) / 255,
    1,
  ];
}

export function rgbaToCss([r, g, b, a]: Rgba): string {
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
}
