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

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(bytes_read) => {
                    let data = String::from_utf8_lossy(&buffer[..bytes_read]).into_owned();

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

pub fn timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}
