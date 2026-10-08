use tauri::{AppHandle, State};

use crate::terminal::engine::EngineManager;
use crate::terminal::manager::TerminalManager;
use crate::terminal::paste::encode_paste;
use crate::terminal::session::{
    CloseTerminalResponse, CreateTerminalRequest, ResizeTerminalRequest, TerminalErrorPayload,
    TerminalSessionInfo,
};

#[tauri::command(rename_all = "camelCase", async)]
pub fn create_terminal(
    app: AppHandle,
    manager: State<'_, TerminalManager>,
    request: CreateTerminalRequest,
) -> Result<TerminalSessionInfo, TerminalErrorPayload> {
    manager.create_terminal(app, request).map_err(Into::into)
}

#[tauri::command(rename_all = "camelCase", async)]
pub fn write_terminal(
    manager: State<'_, TerminalManager>,
    session_id: String,
    data: String,
) -> Result<(), TerminalErrorPayload> {
    manager
        .write_terminal(&session_id, data.as_bytes())
        .map_err(Into::into)
}

/// Writes clipboard text to the PTY as a single paste, bracketed when the
/// running program asked for it — see `terminal::paste::encode_paste`.
#[tauri::command(rename_all = "camelCase", async)]
pub fn paste_terminal(
    manager: State<'_, TerminalManager>,
    engine: State<'_, EngineManager>,
    session_id: String,
    data: String,
) -> Result<(), TerminalErrorPayload> {
    let encoded = encode_paste(&data, engine.bracketed_paste(&session_id));
    manager
        .write_terminal(&session_id, encoded.as_bytes())
        .map_err(Into::into)
}

/// See `TerminalManager::foreground_command`.
#[tauri::command(rename_all = "camelCase", async)]
pub fn terminal_foreground_command(
    manager: State<'_, TerminalManager>,
    session_id: String,
) -> Result<Option<String>, TerminalErrorPayload> {
    manager.foreground_command(&session_id).map_err(Into::into)
}

/// See `TerminalManager::stop_foreground_job`.
#[tauri::command(rename_all = "camelCase", async)]
pub fn terminal_stop_foreground(
    manager: State<'_, TerminalManager>,
    session_id: String,
    force: bool,
) -> Result<(), TerminalErrorPayload> {
    manager
        .stop_foreground_job(&session_id, force)
        .map_err(Into::into)
}

#[tauri::command(rename_all = "camelCase", async)]
pub fn resize_terminal(
    app: AppHandle,
    manager: State<'_, TerminalManager>,
    session_id: String,
    request: ResizeTerminalRequest,
) -> Result<(), TerminalErrorPayload> {
    manager
        .resize_terminal(&app, &session_id, request)
        .map_err(Into::into)
}

#[tauri::command(rename_all = "camelCase", async)]
pub fn close_terminal(
    app: AppHandle,
    manager: State<'_, TerminalManager>,
    session_id: String,
) -> Result<CloseTerminalResponse, TerminalErrorPayload> {
    manager
        .close_terminal(&app, &session_id)
        .map_err(Into::into)
}

#[tauri::command(rename_all = "camelCase", async)]
pub fn list_sessions(
    manager: State<'_, TerminalManager>,
) -> Result<Vec<TerminalSessionInfo>, TerminalErrorPayload> {
    manager.list_sessions().map_err(Into::into)
}

#[tauri::command(rename_all = "camelCase", async)]
pub fn get_terminal_cwd(
    manager: State<'_, TerminalManager>,
    session_id: String,
) -> Result<Option<String>, TerminalErrorPayload> {
    manager.get_terminal_cwd(&session_id).map_err(Into::into)
}

#[tauri::command(rename_all = "camelCase", async)]
pub fn open_url(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| e.to_string())
}

/// How many terminals have a program running in them; the close-confirmation
/// modal only appears when this is non-zero.
#[tauri::command(rename_all = "camelCase")]
pub fn running_process_count(manager: State<'_, TerminalManager>) -> usize {
    manager.running_process_count()
}

/// Kills every terminal and exits the app.
#[tauri::command(rename_all = "camelCase", async)]
pub fn quit_app(app: AppHandle, manager: State<'_, TerminalManager>) {
    manager.close_all(&app);
    app.exit(0);
}
