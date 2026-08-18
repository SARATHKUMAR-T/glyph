use tauri::{AppHandle, State};

use crate::terminal::manager::TerminalManager;
use crate::terminal::session::{
    CloseTerminalResponse, CreateTerminalRequest, ResizeTerminalRequest, TerminalErrorPayload,
    TerminalSessionInfo,
};

#[tauri::command(rename_all = "camelCase")]
pub fn create_terminal(
    app: AppHandle,
    manager: State<'_, TerminalManager>,
    request: CreateTerminalRequest,
) -> Result<TerminalSessionInfo, TerminalErrorPayload> {
    manager.create_terminal(app, request).map_err(Into::into)
}

#[tauri::command(rename_all = "camelCase")]
pub fn write_terminal(
    manager: State<'_, TerminalManager>,
    session_id: String,
    data: String,
) -> Result<(), TerminalErrorPayload> {
    manager
        .write_terminal(&session_id, data.as_bytes())
        .map_err(Into::into)
}

#[tauri::command(rename_all = "camelCase")]
pub fn resize_terminal(
    manager: State<'_, TerminalManager>,
    session_id: String,
    request: ResizeTerminalRequest,
) -> Result<(), TerminalErrorPayload> {
    manager
        .resize_terminal(&session_id, request)
        .map_err(Into::into)
}

#[tauri::command(rename_all = "camelCase")]
pub fn close_terminal(
    manager: State<'_, TerminalManager>,
    session_id: String,
) -> Result<CloseTerminalResponse, TerminalErrorPayload> {
    manager.close_terminal(&session_id).map_err(Into::into)
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_sessions(
    manager: State<'_, TerminalManager>,
) -> Result<Vec<TerminalSessionInfo>, TerminalErrorPayload> {
    manager.list_sessions().map_err(Into::into)
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_terminal_cwd(
    manager: State<'_, TerminalManager>,
    session_id: String,
) -> Result<Option<String>, TerminalErrorPayload> {
    manager.get_terminal_cwd(&session_id).map_err(Into::into)
}

#[tauri::command(rename_all = "camelCase")]
pub fn open_url(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| e.to_string())
}

