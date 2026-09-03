use tauri::State;

use crate::workspace::manager::WorkspaceManager;
use crate::workspace::model::{Workspace, WorkspaceErrorPayload};

#[tauri::command(rename_all = "camelCase")]
pub fn get_workspaces(
    manager: State<'_, WorkspaceManager>,
) -> Result<Vec<Workspace>, WorkspaceErrorPayload> {
    manager.list_workspaces().map_err(Into::into)
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_workspace(
    manager: State<'_, WorkspaceManager>,
    id: String,
) -> Result<Workspace, WorkspaceErrorPayload> {
    manager.get_workspace(&id).map_err(Into::into)
}

#[tauri::command(rename_all = "camelCase")]
pub fn save_workspace(
    manager: State<'_, WorkspaceManager>,
    workspace: Workspace,
) -> Result<Workspace, WorkspaceErrorPayload> {
    manager.save_workspace(workspace).map_err(Into::into)
}

#[tauri::command(rename_all = "camelCase")]
pub fn delete_workspace(
    manager: State<'_, WorkspaceManager>,
    id: String,
) -> Result<(), WorkspaceErrorPayload> {
    manager.delete_workspace(&id).map_err(Into::into)
}
