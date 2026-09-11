/**
 * Decoder for the binary damage-frame wire format produced by the Rust
 * grid engine. Mirrors `src-tauri/src/terminal/engine/protocol.rs` exactly
 * — see that file for the authoritative layout documentation. Keep the two
 * in sync; this file intentionally re-states the layout in comments so it
 * can be read on its own.
 */

export const enum FrameKind {
  Partial = 0,
  Full = 1,
}

export const enum WireCursorShape {
  Block = 0,
  Underline = 1,
  Bar = 2,
  Hidden = 3,
}

// Bit layout of CellRecord.flags (u16), matching protocol.rs `cell_flags`.
export const CellFlags = {
  BOLD: 1 << 0,
  DIM: 1 << 1,
  ITALIC: 1 << 2,
  UNDERLINE: 1 << 3,
  DOUBLE_UNDERLINE: 1 << 4,
  UNDERCURL: 1 << 5,
  DOTTED_UNDERLINE: 1 << 6,
  DASHED_UNDERLINE: 1 << 7,
  STRIKETHROUGH: 1 << 8,
  INVERSE: 1 << 9,
  HIDDEN: 1 << 10,
  WIDE_CHAR: 1 << 11,
  WIDE_CHAR_SPACER: 1 << 12,
  CURSOR_GLOW: 1 << 13,
} as const;

export const ALL_UNDERLINE_FLAGS =
  CellFlags.UNDERLINE |
  CellFlags.DOUBLE_UNDERLINE |
  CellFlags.UNDERCURL |
  CellFlags.DOTTED_UNDERLINE |
  CellFlags.DASHED_UNDERLINE;

const MAGIC = 0x50_59_4c_47; // "GLYP" little-endian, matches protocol::MAGIC
const HEADER_LEN = 24;
const ROW_HEADER_LEN = 8;
const CELL_RECORD_LEN = 16;

export interface DecodedCell {
  codepoint: number;
  fg: number; // packed 0xRRGGBBAA
  bg: number; // packed 0xRRGGBBAA
  flags: number;
  extra: number[];
}

export interface DecodedRow {
  row: number;
  startCol: number;
  cells: DecodedCell[];
}

export interface DecodedFrame {
  kind: FrameKind;
  cols: number;
  rows: number;
  cursorCol: number;
  cursorLine: number;
  cursorShape: WireCursorShape;
  cursorVisible: boolean;
  displayOffset: number;
  totalLines: number;
  rowRecords: DecodedRow[];
}

/**
 * Decodes one frame. Throws if the buffer's magic/version don't match —
 * callers should drop (not attempt to partially render) an unrecognized
 * frame rather than guess at field offsets, per the protocol's versioning
 * policy.
 */
export function decodeFrame(data: ArrayBuffer | Uint8Array): DecodedFrame {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const magic = view.getUint32(0, true);
  if (magic !== MAGIC) {
    throw new Error(`engine frame: bad magic 0x${magic.toString(16)}`);
  }
  const version = view.getUint8(4);
  if (version !== 1) {
    throw new Error(`engine frame: unsupported version ${version}`);
  }

  const kind: FrameKind = view.getUint8(5);
  const cols = view.getUint16(6, true);
  const rows = view.getUint16(8, true);
  const cursorCol = view.getUint16(10, true);
  const cursorLine = view.getUint16(12, true);
  const cursorShape: WireCursorShape = view.getUint8(14);
  const cursorVisible = view.getUint8(15) !== 0;
  const displayOffset = view.getUint32(16, true);
  const totalLines = view.getUint32(20, true);

  const rowRecords: DecodedRow[] = [];
  let offset = HEADER_LEN;

  while (offset < bytes.byteLength) {
    const row = view.getUint16(offset, true);
    const startCol = view.getUint16(offset + 2, true);
    const endCol = view.getUint16(offset + 4, true);
    // bytes [offset+6, offset+8) are reserved padding.
    offset += ROW_HEADER_LEN;

    const cellCount = endCol - startCol + 1;
    const cells: DecodedCell[] = new Array(cellCount);
    const extraCounts: number[] = new Array(cellCount);

    for (let i = 0; i < cellCount; i++) {
      const cellOffset = offset + i * CELL_RECORD_LEN;
      const codepoint = view.getUint32(cellOffset, true);
      const fg = view.getUint32(cellOffset + 4, true);
      const bg = view.getUint32(cellOffset + 8, true);
      const flags = view.getUint16(cellOffset + 12, true);
      const extraLen = view.getUint16(cellOffset + 14, true);
      extraCounts[i] = extraLen;
      cells[i] = { codepoint, fg, bg, flags, extra: [] };
    }
    offset += cellCount * CELL_RECORD_LEN;

    for (let i = 0; i < cellCount; i++) {
      const count = extraCounts[i];
      if (count === 0) continue;
      const extra: number[] = new Array(count);
      for (let j = 0; j < count; j++) {
        extra[j] = view.getUint32(offset, true);
        offset += 4;
      }
      cells[i].extra = extra;
    }

    rowRecords.push({ row, startCol, cells });
  }

  return {
    kind,
    cols,
    rows,
    cursorCol,
    cursorLine,
    cursorShape,
    cursorVisible,
    displayOffset,
    totalLines,
    rowRecords,
  };
}

/** `0xRRGGBBAA` -> a CSS `rgba(...)` string. */
export function packedColorToCss(packed: number): string {
  const r = (packed >>> 24) & 0xff;
  const g = (packed >>> 16) & 0xff;
  const b = (packed >>> 8) & 0xff;
  const a = packed & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

/** Reassembles a cell's display string from its base codepoint plus any
 * combining/zero-width codepoints in its trailer. */
export function cellText(cell: DecodedCell): string {
  if (cell.codepoint === 0 && cell.extra.length === 0) return "";
  let text = String.fromCodePoint(cell.codepoint || 0x20);
  for (const cp of cell.extra) {
    text += String.fromCodePoint(cp);
  }
  return text;
}
