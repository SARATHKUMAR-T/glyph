use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::State;

use crate::terminal::engine::grid_engine::{CursorStyleOption, SearchDirection, SearchMatch};
use crate::terminal::engine::palette::ThemePalette;
use crate::terminal::engine::EngineManager;

/// Start streaming binary damage frames (see `terminal::engine::protocol`)
/// for `session_id` over `channel`.
#[tauri::command(rename_all = "camelCase")]
pub fn engine_attach_channel(
    manager: State<'_, EngineManager>,
    session_id: String,
    channel: Channel,
) {
    manager.attach_channel(session_id, channel);
}

/// Feeds bytes into a session's `GridEngine` directly — bypassing the PTY
/// entirely, so this is visible only in the terminal display, never to the
/// actual shell process. Used for locally-rendered content the shell never
/// produced (e.g. the `quote` built-in's spinner/output;
/// `GlyphEngineTerminalView` clears the shell's real input line separately
/// via `write_terminal` so the two don't collide).
#[tauri::command(rename_all = "camelCase")]
pub fn engine_feed_local(manager: State<'_, EngineManager>, session_id: String, data: String) {
    manager.feed(&session_id, data.as_bytes());
}

/// Applies a theme's colors to every open terminal session (and stores it
/// as the default for sessions created afterward) — see
/// `EngineManager::set_palette`. Called whenever the frontend's active
/// theme changes.
#[tauri::command(rename_all = "camelCase")]
pub fn engine_set_palette(manager: State<'_, EngineManager>, palette: ThemePalette) {
    manager.set_palette(palette);
}

/// Applies the user's cursor-style preference (block/bar/underline) to
/// every open terminal session (and stores it as the default for sessions
/// created afterward) — see `EngineManager::set_cursor_style`. Called
/// whenever the frontend's `cursorStyle` setting changes.
#[tauri::command(rename_all = "camelCase")]
pub fn engine_set_cursor_style(manager: State<'_, EngineManager>, style: CursorStyleOption) {
    manager.set_cursor_style(style);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrollbackInfoPayload {
    pub total_lines: usize,
    pub display_offset: usize,
    pub history_size: usize,
    pub viewport_rows: usize,
    pub viewport_cols: usize,
}

#[tauri::command(rename_all = "camelCase")]
pub fn engine_scrollback_query(
    manager: State<'_, EngineManager>,
    session_id: String,
) -> Option<ScrollbackInfoPayload> {
    manager
        .scrollback_info(&session_id)
        .map(|info| ScrollbackInfoPayload {
            total_lines: info.total_lines,
            display_offset: info.display_offset,
            history_size: info.history_size,
            viewport_rows: info.viewport_rows,
            viewport_cols: info.viewport_cols,
        })
}

#[tauri::command(rename_all = "camelCase")]
pub fn engine_set_scroll(
    manager: State<'_, EngineManager>,
    session_id: String,
    display_offset: usize,
) {
    manager.set_scroll_display_offset(&session_id, display_offset);
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionPoint {
    pub line: i32,
    pub column: usize,
}

#[tauri::command(rename_all = "camelCase")]
pub fn engine_selection_range(
    manager: State<'_, EngineManager>,
    session_id: String,
    start: SelectionPoint,
    end: SelectionPoint,
    block: bool,
) -> Option<String> {
    manager.selection_text(
        &session_id,
        block,
        (start.line, start.column),
        (end.line, end.column),
    )
}

#[tauri::command(rename_all = "camelCase")]
pub fn engine_clear_selection(manager: State<'_, EngineManager>, session_id: String) {
    manager.clear_selection(&session_id);
}

/// Finds the next/previous match of `pattern`, starting from an absolute
/// row (0 = top of scrollback). On a hit, scrolls the match into view as a
/// side effect, matching the existing xterm.js search UI's behaviour.
/// `regex` opts into treating `pattern` as a regular expression instead of
/// literal text (see `GridEngine::search_with_mode`); an invalid pattern in
/// that mode surfaces as an `Err` the frontend shows inline rather than a
/// silent "no match".
#[tauri::command(rename_all = "camelCase")]
pub fn engine_search(
    manager: State<'_, EngineManager>,
    session_id: String,
    pattern: String,
    direction: SearchDirection,
    from_row: usize,
    from_col: usize,
    regex: bool,
) -> Result<Option<SearchMatch>, String> {
    manager.search(&session_id, &pattern, direction, from_row, from_col, regex)
}
