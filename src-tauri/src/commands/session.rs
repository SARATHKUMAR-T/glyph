use tauri::State;

use crate::workspace::manager::WorkspaceManager;
use crate::workspace::model::{Session, WorkspaceErrorPayload};

/// Overwrites the auto-saved session with the frontend's current full tab
/// set. Called (debounced) by `useSessionPersistence` on every structural
/// change to the open tabs — see `Session`'s doc comment in `model.rs` for
/// how this differs from a user-named workspace save.
#[tauri::command(rename_all = "camelCase")]
pub fn save_session(
    manager: State<'_, WorkspaceManager>,
    session: Session,
) -> Result<(), WorkspaceErrorPayload> {
    manager.save_session(&session).map_err(Into::into)
}

/// `Ok(None)` when there's nothing to restore (first launch, cleared
/// session, or a corrupt/invalid file) — the frontend falls back to a
/// single blank tab in that case, same as any other first launch.
#[tauri::command(rename_all = "camelCase")]
pub fn load_session(
    manager: State<'_, WorkspaceManager>,
) -> Result<Option<Session>, WorkspaceErrorPayload> {
    manager.load_session().map_err(Into::into)
}

#[tauri::command(rename_all = "camelCase")]
pub fn clear_session(manager: State<'_, WorkspaceManager>) -> Result<(), WorkspaceErrorPayload> {
    manager.clear_session().map_err(Into::into)
}
