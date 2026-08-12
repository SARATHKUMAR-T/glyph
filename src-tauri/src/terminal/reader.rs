use std::io::{ErrorKind, Read};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};

use crate::events::terminal_events::{
    TerminalErrorEvent, TerminalOutputEvent, TerminalSemanticEvent, ERROR_EVENT, OUTPUT_EVENT,
    SEMANTIC_EVENT,
};

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
        let mut buffer = [0_u8; 8192];
        let mut leftover = Vec::new();

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(bytes_read) => {
                    let mut chunk = Vec::with_capacity(leftover.len() + bytes_read);
                    chunk.extend_from_slice(&leftover);
                    chunk.extend_from_slice(&buffer[..bytes_read]);
                    leftover.clear();

                    let (data, new_leftover) = split_incomplete_utf8(chunk);
                    leftover = new_leftover;

                    if !data.is_empty() {
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

                        let _ = app.emit(
                            OUTPUT_EVENT,
                            TerminalOutputEvent {
                                session_id: session_id.clone(),
                                data,
                            },
                        );
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

fn split_incomplete_utf8(mut chunk: Vec<u8>) -> (String, Vec<u8>) {
    let len = chunk.len();
    let mut cut = len;

    if len >= 1 && (0xC0..=0xFF).contains(&chunk[len - 1]) {
        cut = len - 1;
    } else if len >= 2 && (0xE0..=0xFF).contains(&chunk[len - 2]) && (0x80..=0xBF).contains(&chunk[len - 1]) {
        cut = len - 2;
    } else if len >= 3 && (0xF0..=0xFF).contains(&chunk[len - 3]) && (0x80..=0xBF).contains(&chunk[len - 2]) && (0x80..=0xBF).contains(&chunk[len - 1]) {
        cut = len - 3;
    }

    let leftover = chunk.split_off(cut);
    let text = String::from_utf8_lossy(&chunk).into_owned();
    (text, leftover)
}

pub fn timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}
