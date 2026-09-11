use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::State;

use crate::terminal::engine::grid_engine::{SearchDirection, SearchMatch};
use crate::terminal::engine::manager::engine_enabled;
use crate::terminal::engine::EngineManager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub enabled: bool,
}

/// Whether the Rust grid engine is running for newly created sessions.
/// Lets the frontend decide whether it's worth asking for frames at all.
#[tauri::command(rename_all = "camelCase")]
pub fn engine_status() -> EngineStatus {
    EngineStatus {
        enabled: engine_enabled(),
    }
}

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

/// Finds the next/previous match of `pattern` (plain text, not regex — see
/// `escape_regex` in grid_engine.rs) starting from an absolute row (0 =
/// top of scrollback). On a hit, scrolls the match into view as a side
/// effect, matching the existing xterm.js search UI's behaviour.
#[tauri::command(rename_all = "camelCase")]
pub fn engine_search(
    manager: State<'_, EngineManager>,
    session_id: String,
    pattern: String,
    direction: SearchDirection,
    from_row: usize,
    from_col: usize,
) -> Option<SearchMatch> {
    manager.search(&session_id, &pattern, direction, from_row, from_col)
}
