use std::io::{ErrorKind, Read};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager};

use crate::events::terminal_events::{
    TerminalErrorEvent, TerminalSemanticEvent, ERROR_EVENT, SEMANTIC_EVENT,
};

use super::engine::EngineManager;
use super::osc133::Osc133Parser;
use super::session::TerminalSession;

type SessionMap = Arc<Mutex<std::collections::HashMap<String, TerminalSession>>>;

pub fn spawn_reader_thread(
    app: AppHandle,
    session_id: String,
    mut reader: Box<dyn Read + Send>,
    _sessions: SessionMap,
) {
    thread::spawn(move || {
        let mut parser = Osc133Parser::default();
        // Large reads let bulk output (`cat`, build logs) arrive in few
        // chunks, so the engine lock and the flush wakeup are taken per
        // 64 KiB rather than per 8 KiB.
        let mut buffer = vec![0_u8; 64 * 1024];
        // Bytes of a UTF-8 sequence split across two reads.
        let mut leftover: Vec<u8> = Vec::with_capacity(4);

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(bytes_read) => {
                    // Common case: no carried-over bytes, so decode straight
                    // from the read buffer without copying it first.
                    let joined;
                    let bytes: &[u8] = if leftover.is_empty() {
                        &buffer[..bytes_read]
                    } else {
                        let mut v = std::mem::take(&mut leftover);
                        v.extend_from_slice(&buffer[..bytes_read]);
                        joined = v;
                        &joined
                    };

                    let cut = incomplete_utf8_tail_start(bytes);
                    leftover.extend_from_slice(&bytes[cut..]);
                    let data = String::from_utf8_lossy(&bytes[..cut]);

                    if !data.is_empty() {
                        app.state::<EngineManager>().feed(&session_id, data.as_bytes());

                        for semantic in parser.feed(&data) {
                            let _ = app.emit(
                                SEMANTIC_EVENT,
                                TerminalSemanticEvent {
                                    session_id: session_id.clone(),
                                    kind: semantic.kind.as_wire_name().to_string(),
                                    exit_code: semantic.exit_code,
                                    raw: semantic.raw,
                                    timestamp: timestamp_millis(),
                                },
                            );
                        }
                    }
                }
                Err(error) if error.kind() == ErrorKind::Interrupted => continue,
                Err(error) => {
                    let _ = app.emit(
                        ERROR_EVENT,
                        TerminalErrorEvent {
                            session_id: Some(session_id.clone()),
                            code: "pty_read_failed".to_string(),
                            message: error.to_string(),
                        },
                    );
                    break;
                }
            }
        }
    });
}

/// Index where a trailing, not-yet-complete UTF-8 sequence starts (or
/// `chunk.len()` when the chunk ends on a character boundary).
fn incomplete_utf8_tail_start(chunk: &[u8]) -> usize {
    let len = chunk.len();

    if len >= 1 && (0xC0..=0xFF).contains(&chunk[len - 1]) {
        len - 1
    } else if len >= 2 && (0xE0..=0xFF).contains(&chunk[len - 2]) && (0x80..=0xBF).contains(&chunk[len - 1]) {
        len - 2
    } else if len >= 3
        && (0xF0..=0xFF).contains(&chunk[len - 3])
        && (0x80..=0xBF).contains(&chunk[len - 2])
        && (0x80..=0xBF).contains(&chunk[len - 1])
    {
        len - 3
    } else {
        len
    }
}

pub fn timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}
