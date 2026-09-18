import type { MouseMode } from "./engineProtocol";

/** Viewport-relative selection range (row 0 = top of the visible grid),
 * drawn as a live highlight overlay by the renderer during mouse drag. The
 * authoritative selected *text* still comes from the Rust engine (see
 * `engine_selection_range`) since it alone knows how to trim wide chars
 * and reflowed lines correctly — this is purely the visual highlight.
 *
 * `startCol`/`endCol` (like `startRow`/`endRow`) are both inclusive cell
 * indices — anchor and focus, in whichever order the drag produced them
 * (no need for `startRow <= endRow`); implementations normalize. This
 * matches both the natural "point the mouse is on" mental model and
 * alacritty's own `Point`-based selection/match ranges, so converting a
 * mouse position or an `engine_search` match into this shape never needs
 * an off-by-one adjustment. */
export interface SelectionRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  block: boolean;
  /** `"text"` (default, when omitted) is the subtle drag-selection tint
   * (`--glyph-accent-dim`). `"search"` is a search-match result — drawn
   * with the theme's full `--glyph-accent` at a fixed, higher alpha so a
   * found match reads as an unmistakable, theme-colored highlight instead
   * of blending into the same faint tint used for hover states elsewhere
   * in the UI. */
  kind?: "text" | "search";
}

/**
 * Shared surface both the Canvas2D renderer (Phase 2) and the WebGL2
 * renderer (Phase 3) implement, so `GlyphEngineTerminalView` can pick
 * whichever is available without branching on renderer-specific APIs.
 */
export interface GridRenderer {
  /** (Re)size the backing surface + local grid mirror. Cheap to call
   * repeatedly; must fully repaint. */
  setGrid(cols: number, rows: number): void;
  /** Decode and apply one raw frame from the engine's IPC channel. */
  applyFrameBytes(data: ArrayBuffer | Uint8Array): void;
  setBlinkEnabled(enabled: boolean): void;
  getCellMetrics(): { cellWidth: number; cellHeight: number };
  /** Scrollback offset from the most recently applied frame (0 = live
   * bottom), for converting mouse/search coordinates to/from absolute
   * (scrollback-relative) row numbers — see `coords.ts`. */
  getDisplayOffset(): number;
  /** Scrollback line count from the most recently applied frame. */
  getHistorySize(): number;
  /** The live PTY program's requested mouse-reporting mode from the most
   * recently applied frame — see `mouseReporting.ts`. */
  getMouseMode(): MouseMode;
  /** Plain text of one viewport row, for link detection and word/line
   * selection — reassembled from the local grid mirror, not a fresh IPC
   * round-trip. */
  getRowText(row: number): string;
  /** Cursor position from the most recently applied frame, viewport-row
   * relative like everything else here (0 = top row currently on screen) —
   * for locating the "active" input line (Select All, the `quote`
   * built-in). */
  getCursorPosition(): { row: number; col: number };
  /** Sets (or clears, when `null`) the live selection highlight overlay. */
  setSelection(range: SelectionRange | null): void;
  dispose(): void;
}
