import { CanvasGridRenderer } from "./src/lib/terminal/CanvasGridRenderer";
import { WebGL2GridRenderer } from "./src/lib/terminal/WebGL2GridRenderer";
import { getAllThemes } from "./src/lib/terminal/themes";
import type { GridRenderer } from "./src/lib/terminal/GridRenderer";

function packColor(r: number, g: number, b: number, a = 255): number {
  return (((r << 24) | (g << 16) | (b << 8) | a) >>> 0);
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
}

type CellSpec = { text: string; fg: number; bg: number };

function encodeFrame(cols: number, rows: number, rowCells: CellSpec[][]): ArrayBuffer {
  const HEADER_LEN = 25;
  const ROW_HEADER_LEN = 8;
  const CELL_RECORD_LEN = 16;
  let total = HEADER_LEN;
  for (const cells of rowCells) total += ROW_HEADER_LEN + cells.length * CELL_RECORD_LEN;

  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  view.setUint32(0, 0x50_59_4c_47, true);
  view.setUint8(4, 2); // version
  view.setUint8(5, 1); // FrameKind.Full
  view.setUint16(6, cols, true);
  view.setUint16(8, rows, true);
  view.setUint16(10, 0, true); // cursorCol
  view.setUint16(12, 0, true); // cursorLine
  view.setUint8(14, 3); // WireCursorShape.Hidden
  view.setUint8(15, 0); // cursorVisible = false
  view.setUint32(16, 0, true); // displayOffset
  view.setUint32(20, rows, true); // totalLines
  view.setUint8(24, 0); // mouseMode

  let offset = HEADER_LEN;
  for (let r = 0; r < rowCells.length; r++) {
    const cells = rowCells[r];
    view.setUint16(offset, r, true); // row
    view.setUint16(offset + 2, 0, true); // startCol
    view.setUint16(offset + 4, cells.length - 1, true); // endCol
    view.setUint16(offset + 6, 0, true); // padding
    offset += ROW_HEADER_LEN;
    for (const cell of cells) {
      const cp = cell.text.codePointAt(0) ?? 0x20;
      view.setUint32(offset, cp, true);
      view.setUint32(offset + 4, cell.fg, true);
      view.setUint32(offset + 8, cell.bg, true);
      view.setUint16(offset + 12, 0, true); // flags
      view.setUint16(offset + 14, 0, true); // extraLen
      offset += CELL_RECORD_LEN;
    }
  }
  return buf;
}

function makeRow(cols: number, text: string, fg: [number, number, number], bg: [number, number, number] | null): CellSpec[] {
  const cells: CellSpec[] = [];
  const fgPacked = packColor(...fg);
  const bgPacked = bg ? packColor(...bg) : packColor(0, 0, 0, 0);
  for (let i = 0; i < cols; i++) {
    cells.push({ text: text[i] ?? " ", fg: fgPacked, bg: bgPacked });
  }
  return cells;
}

const container = document.body;
const themes = getAllThemes();
const testThemeIds = ["github-light", "solarized-light", "paper", "nothing-dark", "tokyo-night"];

for (const id of testThemeIds) {
  const theme = themes.find((t) => t.id === id)!;
  for (const selected of [false, true]) {
    const rendererKind = "webgl2" as const;
    const frameWrap = document.createElement("div");
    frameWrap.className = "frame";
    const label = document.createElement("label");
    label.textContent = `${theme.name} (${theme.category}) — ${selected ? "SELECTED" : "unselected"}`;
    const canvas = document.createElement("canvas");
    const cols = 28;
    const rows = 3;
    const cellW = 10;
    const cellH = 20;
    canvas.width = cols * cellW;
    canvas.height = rows * cellH;
    canvas.style.width = `${cols * cellW}px`;
    canvas.style.height = `${rows * cellH}px`;

    // Apply this theme's CSS vars scoped to this canvas via inline style
    // (mirrors what useTerminalTheme does on <html>, but per-swatch here).
    for (const [prop, value] of Object.entries(theme.cssVars)) {
      canvas.style.setProperty(prop, value as string);
    }
    canvas.style.background = theme.category === "light" ? "#ffffff" : "#111111";

    frameWrap.appendChild(label);
    frameWrap.appendChild(canvas);
    container.appendChild(frameWrap);

    let renderer: GridRenderer;
    try {
      renderer =
        rendererKind === "webgl2"
          ? new WebGL2GridRenderer(canvas, { fontFamily: "monospace", fontSize: 14, lineHeight: 1.18 })
          : new CanvasGridRenderer(canvas, { fontFamily: "monospace", fontSize: 14, lineHeight: 1.18 });
    } catch (e) {
      label.textContent += ` [FAILED: ${e}]`;
      continue;
    }
    // Force our own fixed cell metrics (bypass font measurement) via setGrid then override.
    renderer.setGrid(cols, rows);

    const fg = hexToRgb(theme.cssVars["--glyph-fg"]);
    const bg = theme.category === "light" ? hexToRgb(theme.cssVars["--glyph-bg"]) : null;
    const brightBlue = hexToRgb(theme.ansi16[12]);
    const brightGreen = hexToRgb(theme.ansi16[10]);
    const brightCyan = hexToRgb(theme.ansi16[14]);
    const brightYellow = hexToRgb(theme.ansi16[11]);

    const rowCells = [
      makeRow(cols, "Default text sample here", fg, bg),
      [
        ...makeRow(12, "drwxr-xr-x ", fg, bg),
        ...makeRow(6, "src   ", brightBlue, bg),
        ...makeRow(10, "run.sh    ", brightGreen, bg),
      ],
      [
        ...makeRow(12, "user@host:~$", fg, bg),
        ...makeRow(6, " READ ", brightCyan, bg),
        ...makeRow(10, "WARN 4", brightYellow, bg),
      ],
    ];
    const bytes = encodeFrame(cols, rows, rowCells);
    renderer.applyFrameBytes(bytes);

    if (selected) {
      renderer.setSelection({ startRow: 0, startCol: 0, endRow: rows - 1, endCol: cols - 1, block: false });
    }
  }
}
