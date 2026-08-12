use portable_pty::PtySize;

use super::session::TerminalError;

const MIN_COLS: u16 = 2;
const MIN_ROWS: u16 = 2;
const MAX_COLS: u16 = 500;
const MAX_ROWS: u16 = 300;

pub fn validated_size(cols: u16, rows: u16) -> Result<PtySize, TerminalError> {
    if !(MIN_COLS..=MAX_COLS).contains(&cols) || !(MIN_ROWS..=MAX_ROWS).contains(&rows) {
        return Err(TerminalError::InvalidSize { cols, rows });
    }

    Ok(PtySize {
        cols,
        rows,
        pixel_width: 0,
        pixel_height: 0,
    })
}
