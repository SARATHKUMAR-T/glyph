use std::io::Write;
use std::sync::{Arc, Mutex};

use super::session::TerminalError;

pub fn write_all(
    writer: &Arc<Mutex<Box<dyn Write + Send>>>,
    bytes: &[u8],
) -> Result<(), TerminalError> {
    let mut writer = writer.lock().map_err(|_| TerminalError::StateUnavailable)?;
    writer
        .write_all(bytes)
        .and_then(|_| writer.flush())
        .map_err(|error| TerminalError::PtyWrite(error.to_string()))
}
