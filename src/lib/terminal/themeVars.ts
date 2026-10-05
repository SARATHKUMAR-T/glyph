/**
 * Cached reads of theme CSS custom properties for the grid renderers.
 *
 * `getComputedStyle(...).getPropertyValue(...)` forces a style recalculation
 * whenever the DOM is dirty, and the renderers used to call it several times
 * per draw (every drag-selection / search repaint). Theme variables only
 * change when `useTerminalTheme` rewrites <html>'s inline style or its theme
 * data attributes, so values are cached and dropped when those change.
 */
let version = 0;

if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") {
  new MutationObserver(() => {
    version++;
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["style", "class", "data-glyph-theme", "data-glyph-theme-category"],
  });
}

export class ThemeVarCache {
  private seen = -1;
  private values = new Map<string, string>();

  constructor(private readonly element: Element) {}

  get(name: string): string {
    if (this.seen !== version) {
      this.values.clear();
      this.seen = version;
    }
    let value = this.values.get(name);
    if (value === undefined) {
      value = getComputedStyle(this.element).getPropertyValue(name).trim();
      this.values.set(name, value);
    }
    return value;
  }
}
