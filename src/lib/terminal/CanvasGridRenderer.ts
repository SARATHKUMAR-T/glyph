import {
  ALL_UNDERLINE_FLAGS,
  cellText,
  CellFlags,
  decodeFrame,
  FrameKind,
  packedColorToCss,
  WireCursorShape,
  type DecodedCell,
  type DecodedFrame,
} from "./engineProtocol";
import type { GridRenderer, SelectionRange } from "./GridRenderer";

interface RendererOptions {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
}

const BLANK_CELL: DecodedCell = { codepoint: 0x20, fg: 0xf5f5f5ff, bg: 0x00000000, flags: 0, extra: [] };

/** Measures monospace cell metrics without needing a mounted canvas yet —
 * used to compute cols/rows from a container's pixel size before the PTY
 * session (which needs cols/rows) is created. */
export function measureCellMetrics(fontFamily: string, fontSize: number, lineHeight: number) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = `${fontSize}px ${fontFamily}`;
  const cellWidth = Math.max(1, Math.ceil(ctx.measureText("M").width));
  const cellHeight = Math.max(1, Math.ceil(fontSize * lineHeight));
  return { cellWidth, cellHeight };
}

/**
 * Phase 2 Canvas2D renderer: consumes the same binary damage-frame format
 * the future WebGL2 renderer will (see `engineProtocol.ts` /
 * `terminal::engine::protocol` on the Rust side), maintains a full local
 * grid mirror (frames only carry damaged rows), and repaints with plain
 * 2D canvas calls. No glyph atlas, no instancing — that's Phase 3.
 */
export class CanvasGridRenderer implements GridRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private opts: RendererOptions;

  private cols = 0;
  private rows = 0;
  private cellWidth = 0;
  private cellHeight = 0;
  private baseline = 0;
  private dpr = 1;

  private grid: DecodedCell[] = [];
  private text: string[] = [];

  private cursor = {
    col: 0,
    line: 0,
    shape: WireCursorShape.Block as WireCursorShape,
    visible: true,
    blinkOn: true,
  };
  private blinkTimer: ReturnType<typeof setInterval> | null = null;
  private blinkEnabled = false;

  private displayOffset = 0;
  private historySize = 0;
  private selection: SelectionRange | null = null;

  constructor(canvas: HTMLCanvasElement, opts: RendererOptions) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.opts = opts;
  }

  /** Measures cell metrics for the current font and resizes the backing
   * canvas + local grid mirror. Call before the first frame and whenever
   * cols/rows/fontSize change. */
  setGrid(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.dpr = window.devicePixelRatio || 1;

    const { fontFamily, fontSize, lineHeight } = this.opts;
    this.ctx.font = `${fontSize}px ${fontFamily}`;
    // Monospace assumption (same one xterm.js relies on): measure a wide
    // ASCII char for cell width.
    const metrics = this.ctx.measureText("M");
    this.cellWidth = Math.max(1, Math.ceil(metrics.width));
    this.cellHeight = Math.max(1, Math.ceil(fontSize * lineHeight));
    this.baseline = Math.round(this.cellHeight * 0.78);

    this.canvas.width = Math.max(1, cols * this.cellWidth * this.dpr);
    this.canvas.height = Math.max(1, rows * this.cellHeight * this.dpr);
    this.canvas.style.width = `${cols * this.cellWidth}px`;
    this.canvas.style.height = `${rows * this.cellHeight}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.grid = new Array(cols * rows).fill(BLANK_CELL);
    this.text = new Array(cols * rows).fill(" ");
    this.paintAll();
  }

  getCellMetrics() {
    return { cellWidth: this.cellWidth, cellHeight: this.cellHeight };
  }

  getDisplayOffset() {
    return this.displayOffset;
  }

  getHistorySize() {
    return this.historySize;
  }

  getRowText(row: number): string {
    if (row < 0 || row >= this.rows) return "";
    const base = row * this.cols;
    let text = "";
    for (let col = 0; col < this.cols; col++) {
      if (this.grid[base + col].flags & CellFlags.WIDE_CHAR_SPACER) continue;
      text += this.text[base + col];
    }
    return text;
  }

  setSelection(range: SelectionRange | null) {
    const prev = this.selection;
    this.selection = range;
    const rows = new Set<number>();
    if (prev) for (let r = Math.min(prev.startRow, prev.endRow); r <= Math.max(prev.startRow, prev.endRow); r++) rows.add(r);
    if (range) for (let r = Math.min(range.startRow, range.endRow); r <= Math.max(range.startRow, range.endRow); r++) rows.add(r);
    for (const r of rows) this.paintRow(r);
  }

  /** Returns the [fromCol, toCol) highlight span (`toCol` exclusive, for
   * direct use as a `fillRect`/quad width) for `row`, or `null` if this
   * row isn't part of the current selection. `sel`'s own columns are
   * inclusive cell indices — see the `SelectionRange` doc comment. */
  private selectionColsForRow(row: number): [number, number] | null {
    const sel = this.selection;
    if (!sel) return null;
    const top = Math.min(sel.startRow, sel.endRow);
    const bottom = Math.max(sel.startRow, sel.endRow);
    if (row < top || row > bottom) return null;

    if (sel.block) {
      return [Math.min(sel.startCol, sel.endCol), Math.max(sel.startCol, sel.endCol) + 1];
    }

    const startIsTop = sel.startRow <= sel.endRow;
    const leadCol = startIsTop ? sel.startCol : sel.endCol;
    const trailCol = startIsTop ? sel.endCol : sel.startCol;

    if (top === bottom) return [Math.min(leadCol, trailCol), Math.max(leadCol, trailCol) + 1];
    if (row === top) return [leadCol, this.cols];
    if (row === bottom) return [0, trailCol + 1];
    return [0, this.cols];
  }

  setBlinkEnabled(enabled: boolean) {
    this.blinkEnabled = enabled;
    if (this.blinkTimer) {
      clearInterval(this.blinkTimer);
      this.blinkTimer = null;
    }
    this.cursor.blinkOn = true;
    if (enabled) {
      this.blinkTimer = setInterval(() => {
        this.cursor.blinkOn = !this.cursor.blinkOn;
        this.paintRow(this.cursor.line);
      }, 530);
    }
  }

  dispose() {
    if (this.blinkTimer) clearInterval(this.blinkTimer);
    this.blinkTimer = null;
  }

  /** Decodes and applies one raw frame from the engine's IPC channel. */
  applyFrameBytes(data: ArrayBuffer | Uint8Array) {
    const frame = decodeFrame(data);
    this.applyFrame(frame);
  }

  applyFrame(frame: DecodedFrame) {
    if (frame.cols !== this.cols || frame.rows !== this.rows) {
      // Dimensions changed underneath us (e.g. a resize frame arrived
      // before our own resize() call finished) — resync the local mirror
      // to the frame's own dimensions rather than corrupt it.
      this.setGrid(frame.cols, frame.rows);
    }

    const touchedRows = new Set<number>();
    const prevCursorLine = this.cursor.line;

    if (frame.kind === FrameKind.Full) {
      this.grid.fill(BLANK_CELL);
      this.text.fill(" ");
    }

    for (const row of frame.rowRecords) {
      touchedRows.add(row.row);
      const base = row.row * this.cols;
      for (let i = 0; i < row.cells.length; i++) {
        const col = row.startCol + i;
        if (col >= this.cols) break;
        const cell = row.cells[i];
        this.grid[base + col] = cell;
        this.text[base + col] = cellText(cell);
      }
    }

    this.cursor.col = frame.cursorCol;
    this.cursor.line = frame.cursorLine;
    this.cursor.shape = frame.cursorShape;
    this.cursor.visible = frame.cursorVisible;
    this.cursor.blinkOn = true;
    this.displayOffset = frame.displayOffset;
    this.historySize = Math.max(0, frame.totalLines - frame.rows);
    touchedRows.add(prevCursorLine);
    touchedRows.add(this.cursor.line);

    for (const row of touchedRows) {
      this.paintRow(row);
    }
  }

  private paintAll() {
    for (let row = 0; row < this.rows; row++) this.paintRow(row);
  }

  private paintRow(row: number) {
    if (row < 0 || row >= this.rows) return;
    const { ctx, cellWidth, cellHeight, cols } = this;
    const y = row * cellHeight;
    const base = row * cols;

    ctx.clearRect(0, y, cols * cellWidth, cellHeight);

    // Background: batch runs of identical resolved bg color.
    let runStart = 0;
    let runColor = this.resolvedBg(this.grid[base]);
    for (let col = 1; col <= cols; col++) {
      const color = col < cols ? this.resolvedBg(this.grid[base + col]) : null;
      if (color !== runColor) {
        if (runColor && !isTransparent(runColor)) {
          ctx.fillStyle = runColor;
          ctx.fillRect(runStart * cellWidth, y, (col - runStart) * cellWidth, cellHeight);
        }
        runStart = col;
        runColor = color;
      }
    }

    // Foreground text + decorations: batch runs of identical style.
    let col = 0;
    while (col < cols) {
      const cell = this.grid[base + col];
      if (cell.flags & CellFlags.WIDE_CHAR_SPACER) {
        col++;
        continue;
      }
      const isWide = (cell.flags & CellFlags.WIDE_CHAR) !== 0;
      const styleKey = this.styleKey(cell);

      if (isWide) {
        this.drawRun(base, col, col + 1, styleKey);
        col += 2;
        continue;
      }

      let end = col + 1;
      while (
        end < cols &&
        !(this.grid[base + end].flags & (CellFlags.WIDE_CHAR | CellFlags.WIDE_CHAR_SPACER)) &&
        this.styleKey(this.grid[base + end]) === styleKey
      ) {
        end++;
      }
      this.drawRun(base, col, end, styleKey);
      col = end;
    }

    const selCols = this.selectionColsForRow(row);
    if (selCols) {
      const [fromCol, toCol] = selCols;
      ctx.fillStyle = this.themeColor("--glyph-accent-dim", "rgba(255, 48, 48, 0.18)");
      ctx.fillRect(fromCol * cellWidth, y, (toCol - fromCol) * cellWidth, cellHeight);
    }

    if (this.cursor.line === row && this.cursor.visible && this.cursor.blinkOn) {
      this.drawCursor();
    }
  }

  private resolvedBg(cell: DecodedCell): string | null {
    const inverse = (cell.flags & CellFlags.INVERSE) !== 0;
    const packed = inverse ? cell.fg : cell.bg;
    return packedColorToCss(packed);
  }

  private resolvedFg(cell: DecodedCell): string {
    const inverse = (cell.flags & CellFlags.INVERSE) !== 0;
    const packed = inverse ? cell.bg : cell.fg;
    return packedColorToCss(packed);
  }

  private styleKey(cell: DecodedCell): string {
    return `${this.resolvedFg(cell)}|${cell.flags & (CellFlags.BOLD | CellFlags.ITALIC | CellFlags.DIM | CellFlags.INVERSE | CellFlags.HIDDEN)}`;
  }

  private drawRun(base: number, startCol: number, endCol: number, _styleKey: string) {
    const cell = this.grid[base + startCol];
    if (cell.flags & CellFlags.HIDDEN) return;

    const { ctx, cellWidth, cellHeight, baseline } = this;
    const row = Math.floor(base / this.cols);
    const y = row * cellHeight;
    const x = startCol * cellWidth;

    let text = "";
    for (let c = startCol; c < endCol; c++) text += this.text[base + c];

    const bold = (cell.flags & CellFlags.BOLD) !== 0;
    const italic = (cell.flags & CellFlags.ITALIC) !== 0;
    const dim = (cell.flags & CellFlags.DIM) !== 0;

    ctx.font = `${italic ? "italic " : ""}${bold ? "700" : "400"} ${this.opts.fontSize}px ${this.opts.fontFamily}`;
    ctx.textBaseline = "alphabetic";
    ctx.globalAlpha = dim ? 0.65 : 1;
    ctx.fillStyle = this.resolvedFg(cell);
    ctx.fillText(text, x, y + baseline);
    ctx.globalAlpha = 1;

    if (cell.flags & ALL_UNDERLINE_FLAGS) {
      ctx.strokeStyle = this.resolvedFg(cell);
      ctx.lineWidth = 1;
      const uy = y + baseline + 2.5;
      ctx.beginPath();
      if (cell.flags & CellFlags.DOTTED_UNDERLINE) {
        ctx.setLineDash([1, 2]);
      } else if (cell.flags & CellFlags.DASHED_UNDERLINE) {
        ctx.setLineDash([4, 2]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.moveTo(x, uy);
      ctx.lineTo(x + (endCol - startCol) * cellWidth, uy);
      ctx.stroke();
      if (cell.flags & CellFlags.DOUBLE_UNDERLINE) {
        ctx.beginPath();
        ctx.moveTo(x, uy + 2);
        ctx.lineTo(x + (endCol - startCol) * cellWidth, uy + 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    if (cell.flags & CellFlags.STRIKETHROUGH) {
      ctx.strokeStyle = this.resolvedFg(cell);
      ctx.lineWidth = 1;
      const sy = y + baseline - cellHeight * 0.28;
      ctx.beginPath();
      ctx.moveTo(x, sy);
      ctx.lineTo(x + (endCol - startCol) * cellWidth, sy);
      ctx.stroke();
    }
  }

  private themeColor(varName: string, fallback: string): string {
    const value = getComputedStyle(this.canvas).getPropertyValue(varName).trim();
    return value || fallback;
  }

  private drawCursor() {
    const { ctx, cellWidth, cellHeight, baseline } = this;
    const x = this.cursor.col * cellWidth;
    const y = this.cursor.line * cellHeight;
    const accent = this.themeColor("--glyph-accent", "#ff3030");
    const glow = this.themeColor("--glyph-accent-glow", "rgba(255, 48, 48, 0.45)");
    const bg = this.themeColor("--glyph-bg", "#000000");

    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur = 6;
    ctx.fillStyle = accent;

    switch (this.cursor.shape) {
      case WireCursorShape.Block: {
        ctx.fillRect(x, y, cellWidth, cellHeight);
        ctx.shadowBlur = 0;
        const idx = this.cursor.line * this.cols + this.cursor.col;
        const under = this.text[idx];
        if (under && under !== " ") {
          ctx.fillStyle = bg;
          ctx.font = `${this.opts.fontSize}px ${this.opts.fontFamily}`;
          ctx.fillText(under, x, y + baseline);
        }
        break;
      }
      case WireCursorShape.Bar:
        ctx.fillRect(x, y, 3.5, cellHeight);
        break;
      case WireCursorShape.Underline:
        ctx.fillRect(x, y + cellHeight - 3.5, cellWidth, 3.5);
        break;
      case WireCursorShape.Hidden:
      default:
        break;
    }
    ctx.restore();
  }
}

function isTransparent(cssColor: string): boolean {
  return cssColor.endsWith(", 0.000)") || cssColor === "rgba(0, 0, 0, 0.000)";
}
