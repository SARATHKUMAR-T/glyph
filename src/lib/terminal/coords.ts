/**
 * Conversions between "viewport row" (0-based, top of the visible grid —
 * what mouse math and cell rendering use) and "absolute row" (0-based,
 * top of scrollback — what `engine_search` takes/returns, since a search
 * result must stay meaningful even after the view scrolls).
 *
 * Both are derived from the same relationship alacritty's own
 * `viewport_to_point` uses on the Rust side: a grid line (which can be
 * negative, for scrollback) equals `viewportRow - displayOffset`, and an
 * absolute row is a grid line shifted up by the full history size so it's
 * never negative: `absoluteRow = gridLine + historySize`.
 */

export function absoluteRowToViewport(absoluteRow: number, displayOffset: number, historySize: number): number {
  return absoluteRow + displayOffset - historySize;
}

export function viewportRowToAbsolute(viewportRow: number, displayOffset: number, historySize: number): number {
  return viewportRow + historySize - displayOffset;
}

/** Mirrors `GridEngine::search`'s reveal logic so the frontend can predict
 * the resulting scroll position immediately, instead of waiting for the
 * next frame, for snappier search-result highlighting. */
export function displayOffsetToReveal(absoluteRow: number, historySize: number): number {
  return Math.max(0, Math.min(historySize, historySize - absoluteRow));
}

/** `engine_selection_range` takes raw alacritty grid `Line` coordinates
 * (which can be negative, for scrollback) rather than the absolute-row
 * space `engine_search` uses — this is the simpler direct conversion for
 * that command's mouse-selection call site. */
export function viewportRowToGridLine(viewportRow: number, displayOffset: number): number {
  return viewportRow - displayOffset;
}
