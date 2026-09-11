use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::ipc::{Channel, InvokeResponseBody};

use super::grid_engine::{GridEngine, ScrollbackInfo, SearchDirection, SearchMatch};

/// How often the flush thread checks the grid for damage and, if any is
/// found, sends a frame over the channel. ~4ms matches a 240Hz budget,
/// comfortably under a 60Hz frame (16.6ms) so batching stays invisible.
const FLUSH_INTERVAL: Duration = Duration::from_millis(4);

const DEFAULT_SCROLLBACK: usize = 10_000;

struct EngineSession {
    engine: Arc<Mutex<GridEngine>>,
    stop_flush: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct EngineManager {
    sessions: Mutex<HashMap<String, EngineSession>>,
}

/// Whether the experimental Rust grid engine should run alongside the
/// existing xterm.js pipeline for newly created sessions. Off by default;
/// set `GLYPH_RUST_ENGINE=1` to A/B it.
pub fn engine_enabled() -> bool {
    std::env::var("GLYPH_RUST_ENGINE")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

impl EngineManager {
    pub fn create_session(&self, session_id: String, cols: u16, rows: u16) {
        let engine = Arc::new(Mutex::new(GridEngine::new(cols, rows, DEFAULT_SCROLLBACK)));
        let session = EngineSession {
            engine,
            stop_flush: Arc::new(AtomicBool::new(false)),
        };

        if let Ok(mut sessions) = self.sessions.lock() {
            if let Some(old) = sessions.insert(session_id, session) {
                old.stop_flush.store(true, Ordering::SeqCst);
            }
        }
    }

    pub fn remove_session(&self, session_id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            if let Some(session) = sessions.remove(session_id) {
                session.stop_flush.store(true, Ordering::SeqCst);
            }
        }
    }

    pub fn feed(&self, session_id: &str, bytes: &[u8]) {
        let engine = self.engine_handle(session_id);
        if let Some(engine) = engine {
            if let Ok(mut engine) = engine.lock() {
                engine.feed(bytes);
            }
        }
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) {
        if let Some(engine) = self.engine_handle(session_id) {
            if let Ok(mut engine) = engine.lock() {
                engine.resize(cols, rows);
            }
        }
    }

    pub fn set_scroll_display_offset(&self, session_id: &str, display_offset: usize) {
        if let Some(engine) = self.engine_handle(session_id) {
            if let Ok(mut engine) = engine.lock() {
                engine.set_scroll_display_offset(display_offset);
            }
        }
    }

    pub fn scrollback_info(&self, session_id: &str) -> Option<ScrollbackInfo> {
        let engine = self.engine_handle(session_id)?;
        let engine = engine.lock().ok()?;
        Some(engine.scrollback_info())
    }

    pub fn selection_text(
        &self,
        session_id: &str,
        block: bool,
        start: (i32, usize),
        end: (i32, usize),
    ) -> Option<String> {
        let engine = self.engine_handle(session_id)?;
        let mut engine = engine.lock().ok()?;
        engine.selection_text(block, start, end)
    }

    pub fn clear_selection(&self, session_id: &str) {
        if let Some(engine) = self.engine_handle(session_id) {
            if let Ok(mut engine) = engine.lock() {
                engine.clear_selection();
            }
        }
    }

    pub fn search(
        &self,
        session_id: &str,
        pattern: &str,
        direction: SearchDirection,
        from_row: usize,
        from_col: usize,
    ) -> Option<SearchMatch> {
        let engine = self.engine_handle(session_id)?;
        let mut engine = engine.lock().ok()?;
        engine.search(pattern, direction, from_row, from_col)
    }

    /// Start streaming damage frames for `session_id` over `channel` at the
    /// flush cadence. Only one flush thread runs per session; calling this
    /// again for the same session replaces the previous channel.
    pub fn attach_channel(&self, session_id: String, channel: Channel) {
        let (engine, stop_flush) = {
            let sessions = self.sessions.lock().unwrap();
            let Some(session) = sessions.get(&session_id) else {
                return;
            };
            (Arc::clone(&session.engine), Arc::clone(&session.stop_flush))
        };

        thread::spawn(move || loop {
            if stop_flush.load(Ordering::SeqCst) {
                break;
            }
            thread::sleep(FLUSH_INTERVAL);
            if stop_flush.load(Ordering::SeqCst) {
                break;
            }

            let frame = {
                let Ok(mut engine) = engine.lock() else {
                    break;
                };
                engine.build_frame()
            };

            if let Some(frame) = frame {
                if channel.send(InvokeResponseBody::Raw(frame)).is_err() {
                    break;
                }
            }
        });
    }

    fn engine_handle(&self, session_id: &str) -> Option<Arc<Mutex<GridEngine>>> {
        self.sessions
            .lock()
            .ok()?
            .get(session_id)
            .map(|session| Arc::clone(&session.engine))
    }
}
