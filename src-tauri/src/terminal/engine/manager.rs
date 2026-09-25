use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::ipc::{Channel, InvokeResponseBody};

use super::grid_engine::{CursorStyleOption, GridEngine, ScrollbackInfo, SearchDirection, SearchMatch};
use super::palette::{self, ThemePalette};

/// How often the flush thread checks the grid for damage and, if any is
/// found, sends a frame over the channel. ~4ms matches a 240Hz budget,
/// comfortably under a 60Hz frame (16.6ms) so batching stays invisible.
const FLUSH_INTERVAL: Duration = Duration::from_millis(4);

const DEFAULT_SCROLLBACK: usize = 10_000;

struct EngineSession {
    engine: Arc<Mutex<GridEngine>>,
    stop_flush: Arc<AtomicBool>,
    /// Stop flag of the flush thread serving the currently attached
    /// channel. Replaced on every `attach_channel` so only one flush thread
    /// ever drains this session's damage at a time.
    stop_channel: Arc<AtomicBool>,
}

pub struct EngineManager {
    sessions: Mutex<HashMap<String, EngineSession>>,
    /// The most recently pushed theme palette (`set_palette`), applied to
    /// every session that exists when it's pushed and to every session
    /// created afterward — so a theme switch takes effect immediately and
    /// new panes/tabs don't briefly flash the wrong theme's colors.
    current_palette: Mutex<ThemePalette>,
    /// The most recently pushed cursor-style preference (`set_cursor_style`),
    /// applied the same way as `current_palette` above so new panes start
    /// with the user's chosen shape instead of alacritty's own Block
    /// default.
    current_cursor_style: Mutex<CursorStyleOption>,
}

impl Default for EngineManager {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            current_palette: Mutex::new(palette::default_theme_palette()),
            current_cursor_style: Mutex::new(CursorStyleOption::Bar),
        }
    }
}

impl EngineManager {
    pub fn create_session(&self, session_id: String, cols: u16, rows: u16) {
        let mut grid_engine = GridEngine::new(cols, rows, DEFAULT_SCROLLBACK);
        if let Ok(palette) = self.current_palette.lock() {
            grid_engine.set_palette(&palette);
        }
        if let Ok(style) = self.current_cursor_style.lock() {
            grid_engine.set_cursor_style(*style);
        }
        let engine = Arc::new(Mutex::new(grid_engine));
        let session = EngineSession {
            engine,
            stop_flush: Arc::new(AtomicBool::new(false)),
            stop_channel: Arc::new(AtomicBool::new(false)),
        };

        if let Ok(mut sessions) = self.sessions.lock() {
            if let Some(old) = sessions.insert(session_id, session) {
                old.stop_flush.store(true, Ordering::SeqCst);
                old.stop_channel.store(true, Ordering::SeqCst);
            }
        }
    }

    /// Pushes a theme's colors to every open session and stores it as the
    /// default for sessions created afterward — see `current_palette`.
    pub fn set_palette(&self, palette: ThemePalette) {
        if let Ok(mut current) = self.current_palette.lock() {
            *current = palette;
        }
        if let Ok(sessions) = self.sessions.lock() {
            for session in sessions.values() {
                if let Ok(mut engine) = session.engine.lock() {
                    engine.set_palette(&palette);
                }
            }
        }
    }

    /// Pushes a cursor-style preference to every open session and stores it
    /// as the default for sessions created afterward — see
    /// `current_cursor_style`.
    pub fn set_cursor_style(&self, style: CursorStyleOption) {
        if let Ok(mut current) = self.current_cursor_style.lock() {
            *current = style;
        }
        if let Ok(sessions) = self.sessions.lock() {
            for session in sessions.values() {
                if let Ok(mut engine) = session.engine.lock() {
                    engine.set_cursor_style(style);
                }
            }
        }
    }

    pub fn remove_session(&self, session_id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            if let Some(session) = sessions.remove(session_id) {
                session.stop_flush.store(true, Ordering::SeqCst);
                session.stop_channel.store(true, Ordering::SeqCst);
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
        use_regex: bool,
    ) -> Result<Option<SearchMatch>, String> {
        let Some(engine) = self.engine_handle(session_id) else {
            return Ok(None);
        };
        let mut engine = engine.lock().map_err(|_| "engine lock poisoned".to_string())?;
        engine.search_with_mode(pattern, direction, from_row, from_col, use_regex)
    }

    /// Start streaming damage frames for `session_id` over `channel` at the
    /// flush cadence. Only one flush thread runs per session; calling this
    /// again for the same session replaces the previous channel.
    pub fn attach_channel(&self, session_id: String, channel: Channel) {
        let (engine, stop_flush, stop_channel) = {
            let mut sessions = self.sessions.lock().unwrap();
            let Some(session) = sessions.get_mut(&session_id) else {
                return;
            };
            // Retire the previous channel's flush thread. Left running, it
            // would keep consuming the engine's damage and sending it to a
            // renderer that no longer exists, starving the new one.
            session.stop_channel.store(true, Ordering::SeqCst);
            let stop_channel = Arc::new(AtomicBool::new(false));
            session.stop_channel = Arc::clone(&stop_channel);
            (Arc::clone(&session.engine), Arc::clone(&session.stop_flush), stop_channel)
        };

        // The new channel's renderer starts blank, so its first frame must
        // repaint the whole grid rather than only what changed since the
        // previous channel's last frame.
        if let Ok(mut engine) = engine.lock() {
            engine.request_full_frame();
        }

        let stopped = move || stop_flush.load(Ordering::SeqCst) || stop_channel.load(Ordering::SeqCst);

        thread::spawn(move || loop {
            if stopped() {
                break;
            }
            thread::sleep(FLUSH_INTERVAL);
            if stopped() {
                break;
            }

            let frame = {
                let Ok(mut engine) = engine.lock() else {
                    break;
                };
                // Re-checked under the lock: a thread retired while waiting
                // on it must not consume the full frame requested for its
                // replacement.
                if stopped() {
                    break;
                }
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
