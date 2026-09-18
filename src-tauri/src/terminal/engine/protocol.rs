//! Binary damage-frame wire format sent from the Rust grid engine to the
//! frontend over a `tauri::ipc::Channel<Vec<u8>>`.
//!
//! # Design goals
//! - Cheap to encode on the Rust side (no allocation beyond one `Vec<u8>`,
//!   no serde/JSON).
//! - Cheap to decode on the JS side (flat `DataView` reads, no parsing
//!   loop beyond the fixed-size records below).
//! - Only damaged rows are ever included, so a quiescent terminal (idle
//!   shell prompt) produces near-zero-byte frames on every ~4ms tick.
//! - Colors are resolved to concrete RGBA on the Rust side. The frontend
//!   renderer never needs a copy of the palette/theme.
//!
//! All multi-byte integers are little-endian. All offsets below are byte
//! offsets from the start of the frame.
//!
//! ```text
//! FrameHeader (25 bytes, at offset 0):
//!   offset  size  field            description
//!   0       4     magic            0x50_59_4C_47 ("GLYP" as LE u32)
//!   4       1     version          protocol version, currently 2
//!   5       1     frame_kind       0 = Partial (only damaged rows follow)
//!                                  1 = Full    (every row 0..rows follows,
//!                                               used for first frame / resize
//!                                               / scroll-position jump)
//!   6       2     cols             grid width in columns
//!   8       2     rows             viewport height in rows
//!   10      2     cursor_col       cursor column, 0-based
//!   12      2     cursor_line      cursor row within viewport, 0-based
//!   14      1     cursor_shape     0 = Block, 1 = Underline, 2 = Bar,
//!                                  3 = Hidden
//!   15      1     cursor_visible   0 or 1
//!   16      4     display_offset   scrollback offset (0 = scrolled to the
//!                                  live bottom), in lines
//!   20      4     total_lines      history + viewport line count, for
//!                                  scrollbar sizing
//!   24      1     mouse_mode       the live PTY program's requested mouse
//!                                  reporting mode, see `mouse_mode` below —
//!                                  added in version 2 so the frontend can
//!                                  forward mouse clicks/drags/wheel to
//!                                  mouse-aware programs (vim, htop, tmux)
//!                                  instead of always treating the mouse as
//!                                  local-only text selection.
//!
//! Then, back to back, `num_damaged_rows` RowRecords, where
//! `num_damaged_rows` is NOT stored in the header — the reader keeps
//! decoding RowRecords until it has consumed the whole buffer. This keeps
//! the header fixed-size and avoids a redundant count field.
//!
//! RowRecord (8-byte row header + 16 bytes per cell):
//!   offset  size  field            description
//!   0       2     row              viewport row index, 0-based
//!   2       2     start_col        first damaged column (inclusive)
//!   4       2     end_col          last damaged column (inclusive)
//!   6       2     reserved         padding, always 0
//!   8       ..    cells            (end_col - start_col + 1) CellRecords
//!
//! CellRecord (16 bytes):
//!   offset  size  field            description
//!   0       4     codepoint        UTF-32 scalar value of the cell's base
//!                                  character. 0x20 (space) for a blank
//!                                  cell, 0 for the trailing spacer cell of
//!                                  a wide (CJK/emoji) character.
//!   4       4     fg               packed 0xRRGGBBAA, straight alpha
//!   8       4     bg               packed 0xRRGGBBAA, straight alpha
//!   12      2     flags            see `CellFlags` below
//!   14      2     extra_len        number of combining/zero-width
//!                                  codepoints appended for this cell in
//!                                  the row's trailer (see below). 0 for
//!                                  the overwhelming majority of cells.
//!
//! Row trailer (only present when any cell in the row has extra_len > 0):
//!   Immediately after the row's CellRecords, for each cell with
//!   extra_len = N > 0, N little-endian u32 codepoints are appended, in
//!   cell (left-to-right) order. The reader already knows N per cell from
//!   the CellRecord it just read, so no additional framing is needed.
//! ```
//!
//! ## CellFlags bit layout (u16)
//! ```text
//! bit 0   BOLD
//! bit 1   DIM
//! bit 2   ITALIC
//! bit 3   UNDERLINE          (plain single underline)
//! bit 4   DOUBLE_UNDERLINE
//! bit 5   UNDERCURL
//! bit 6   DOTTED_UNDERLINE
//! bit 7   DASHED_UNDERLINE
//! bit 8   STRIKETHROUGH
//! bit 9   INVERSE
//! bit 10  HIDDEN
//! bit 11  WIDE_CHAR          (this cell occupies 2 columns)
//! bit 12  WIDE_CHAR_SPACER   (this cell is the trailing half of a wide char)
//! bit 13  CURSOR_GLOW        (reserved for the glowing-red cursor cell;
//!                             currently unused by the encoder, the cursor
//!                             is drawn by the renderer from the header's
//!                             cursor_col/cursor_line instead)
//! bit 14  reserved
//! bit 15  reserved
//! ```
//! Underline bits 4-7 are mutually exclusive with bit 3 and with each
//! other; at most one underline-style bit is ever set.
//!
//! ## `mouse_mode` bit layout (u8)
//! ```text
//! bits 0-1  tracking level   0 = Off      (no mouse reporting requested)
//!                            1 = Click    (`?1000`: button press/release
//!                                          only, no motion)
//!                            2 = Drag     (`?1002`: press/release plus
//!                                          motion while a button is held)
//!                            3 = AnyMotion (`?1003`: press/release plus
//!                                          every motion event, even with
//!                                          no button held)
//! bit  2    sgr              `?1006` is set: encode reports as
//!                             `CSI < Cb ; Cx ; Cy M`/`m` (press/release)
//!                             instead of the legacy fixed-width form.
//!                             Column/row are sent as decimal text, so this
//!                             has no coordinate ceiling; prefer this
//!                             encoding whenever it's set.
//! bits 3-7  reserved
//! ```
//! `sgr` and the legacy `utf8` extended mode (`?1005`) are mutually
//! exclusive in `alacritty_terminal`'s own mode bits (setting one clears
//! the other), and `1005` is obsolete in favor of `1006` in every mouse-
//! aware program in practice, so it is not surfaced as a separate bit here
//! — a program that requests only `1005` gets the legacy fixed-width
//! encoding (`sgr` bit unset), which still works up to column/row 223.
//!
//! ## Versioning
//! `version` must be bumped on any incompatible layout change. The decoder
//! must refuse to render a frame whose version it does not recognize
//! rather than guess at field offsets.

pub const MAGIC: u32 = u32::from_le_bytes(*b"GLYP");
pub const VERSION: u8 = 2;

pub const HEADER_LEN: usize = 25;
pub const ROW_HEADER_LEN: usize = 8;
pub const CELL_RECORD_LEN: usize = 16;

/// `mouse_mode` bit layout — see the module doc comment above.
pub mod mouse_mode {
    pub const TRACKING_MASK: u8 = 0b0000_0011;
    pub const TRACKING_OFF: u8 = 0;
    pub const TRACKING_CLICK: u8 = 1;
    pub const TRACKING_DRAG: u8 = 2;
    pub const TRACKING_ANY_MOTION: u8 = 3;
    pub const SGR: u8 = 1 << 2;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum FrameKind {
    Partial = 0,
    Full = 1,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum WireCursorShape {
    Block = 0,
    Underline = 1,
    Bar = 2,
    Hidden = 3,
}

pub mod cell_flags {
    pub const BOLD: u16 = 1 << 0;
    pub const DIM: u16 = 1 << 1;
    pub const ITALIC: u16 = 1 << 2;
    pub const UNDERLINE: u16 = 1 << 3;
    pub const DOUBLE_UNDERLINE: u16 = 1 << 4;
    pub const UNDERCURL: u16 = 1 << 5;
    pub const DOTTED_UNDERLINE: u16 = 1 << 6;
    pub const DASHED_UNDERLINE: u16 = 1 << 7;
    pub const STRIKETHROUGH: u16 = 1 << 8;
    pub const INVERSE: u16 = 1 << 9;
    pub const HIDDEN: u16 = 1 << 10;
    pub const WIDE_CHAR: u16 = 1 << 11;
    pub const WIDE_CHAR_SPACER: u16 = 1 << 12;
    pub const CURSOR_GLOW: u16 = 1 << 13;
}

/// A single resolved cell, ready to be packed into the wire format.
#[derive(Clone, Debug, Default)]
pub struct WireCell {
    pub codepoint: u32,
    pub fg: u32,
    pub bg: u32,
    pub flags: u16,
    pub extra: Vec<u32>,
}

/// One damaged (or, for a Full frame, every) row.
pub struct WireRow {
    pub row: u16,
    pub start_col: u16,
    pub cells: Vec<WireCell>,
}

pub struct FrameHeader {
    pub kind: FrameKind,
    pub cols: u16,
    pub rows: u16,
    pub cursor_col: u16,
    pub cursor_line: u16,
    pub cursor_shape: WireCursorShape,
    pub cursor_visible: bool,
    pub display_offset: u32,
    pub total_lines: u32,
    pub mouse_mode: u8,
}

/// Encode a full frame: header + row records, little-endian, per the
/// layout documented at the top of this module.
pub fn encode_frame(header: &FrameHeader, wire_rows: &[WireRow]) -> Vec<u8> {
    let mut estimated = HEADER_LEN;
    for row in wire_rows {
        estimated += ROW_HEADER_LEN + row.cells.len() * CELL_RECORD_LEN;
        estimated += row.cells.iter().map(|c| c.extra.len() * 4).sum::<usize>();
    }

    let mut buf = Vec::with_capacity(estimated);

    buf.extend_from_slice(&MAGIC.to_le_bytes());
    buf.push(VERSION);
    buf.push(header.kind as u8);
    buf.extend_from_slice(&header.cols.to_le_bytes());
    buf.extend_from_slice(&header.rows.to_le_bytes());
    buf.extend_from_slice(&header.cursor_col.to_le_bytes());
    buf.extend_from_slice(&header.cursor_line.to_le_bytes());
    buf.push(header.cursor_shape as u8);
    buf.push(header.cursor_visible as u8);
    buf.extend_from_slice(&header.display_offset.to_le_bytes());
    buf.extend_from_slice(&header.total_lines.to_le_bytes());
    buf.push(header.mouse_mode);
    debug_assert_eq!(buf.len(), HEADER_LEN);

    for row in wire_rows {
        if row.cells.is_empty() {
            continue;
        }
        let end_col = row.start_col + row.cells.len() as u16 - 1;
        buf.extend_from_slice(&row.row.to_le_bytes());
        buf.extend_from_slice(&row.start_col.to_le_bytes());
        buf.extend_from_slice(&end_col.to_le_bytes());
        buf.extend_from_slice(&0u16.to_le_bytes()); // reserved

        for cell in &row.cells {
            buf.extend_from_slice(&cell.codepoint.to_le_bytes());
            buf.extend_from_slice(&cell.fg.to_le_bytes());
            buf.extend_from_slice(&cell.bg.to_le_bytes());
            buf.extend_from_slice(&cell.flags.to_le_bytes());
            buf.extend_from_slice(&(cell.extra.len() as u16).to_le_bytes());
        }
        for cell in &row.cells {
            for &cp in &cell.extra {
                buf.extend_from_slice(&cp.to_le_bytes());
            }
        }
    }

    buf
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_round_trips_via_manual_offsets() {
        let header = FrameHeader {
            kind: FrameKind::Full,
            cols: 80,
            rows: 24,
            cursor_col: 5,
            cursor_line: 3,
            cursor_shape: WireCursorShape::Bar,
            cursor_visible: true,
            display_offset: 0,
            total_lines: 24,
            mouse_mode: mouse_mode::TRACKING_DRAG | mouse_mode::SGR,
        };
        let frame = encode_frame(&header, &[]);
        assert_eq!(frame.len(), HEADER_LEN);
        assert_eq!(u32::from_le_bytes(frame[0..4].try_into().unwrap()), MAGIC);
        assert_eq!(frame[4], VERSION);
        assert_eq!(frame[5], FrameKind::Full as u8);
        assert_eq!(u16::from_le_bytes(frame[6..8].try_into().unwrap()), 80);
        assert_eq!(u16::from_le_bytes(frame[8..10].try_into().unwrap()), 24);
        assert_eq!(u16::from_le_bytes(frame[10..12].try_into().unwrap()), 5);
        assert_eq!(u16::from_le_bytes(frame[12..14].try_into().unwrap()), 3);
        assert_eq!(frame[14], WireCursorShape::Bar as u8);
        assert_eq!(frame[15], 1);
        assert_eq!(frame[24], mouse_mode::TRACKING_DRAG | mouse_mode::SGR);
    }

    #[test]
    fn row_with_cells_and_extras_encodes_expected_length() {
        let header = FrameHeader {
            kind: FrameKind::Partial,
            cols: 10,
            rows: 1,
            cursor_col: 0,
            cursor_line: 0,
            cursor_shape: WireCursorShape::Block,
            cursor_visible: true,
            display_offset: 0,
            total_lines: 1,
            mouse_mode: mouse_mode::TRACKING_OFF,
        };
        let row = WireRow {
            row: 0,
            start_col: 2,
            cells: vec![
                WireCell {
                    codepoint: 'a' as u32,
                    fg: 0xffffffff,
                    bg: 0x000000ff,
                    flags: 0,
                    extra: vec![],
                },
                WireCell {
                    codepoint: 'e' as u32,
                    fg: 0xffffffff,
                    bg: 0x000000ff,
                    flags: 0,
                    extra: vec![0x0301],
                },
            ],
        };
        let frame = encode_frame(&header, &[row]);
        let expected = HEADER_LEN + ROW_HEADER_LEN + 2 * CELL_RECORD_LEN + 4;
        assert_eq!(frame.len(), expected);
    }
}
