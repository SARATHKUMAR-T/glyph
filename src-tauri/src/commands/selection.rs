//! The Linux PRIMARY selection — what a plain mouse selection sets and a
//! middle-click pastes in every X11/Wayland terminal, separate from the
//! Ctrl+C/Ctrl+V clipboard. Sharing it with the system (rather than keeping
//! it inside the webview) lets text selected in Glyph middle-click-paste
//! into other apps, and vice versa.

use std::sync::Mutex;

use tauri::State;

/// One long-lived clipboard handle. On X11 and Wayland the selection's
/// contents are served on demand by the process that owns it, so the
/// handle has to outlive each `set` call — dropping it would make the
/// selection vanish for every other app.
#[derive(Default)]
pub struct PrimarySelectionState(Mutex<Option<arboard::Clipboard>>);

#[cfg(target_os = "linux")]
fn with_clipboard<T>(
    state: &PrimarySelectionState,
    f: impl FnOnce(&mut arboard::Clipboard) -> Result<T, arboard::Error>,
) -> Result<T, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        *guard = Some(arboard::Clipboard::new().map_err(|e| e.to_string())?);
    }
    let clipboard = guard.as_mut().expect("clipboard initialized above");
    f(clipboard).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase", async)]
pub fn set_primary_selection(
    state: State<'_, PrimarySelectionState>,
    text: String,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        use arboard::{LinuxClipboardKind, SetExtLinux};
        with_clipboard(&state, |c| {
            c.set().clipboard(LinuxClipboardKind::Primary).text(text)
        })
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (state, text);
        Ok(())
    }
}

/// Returns `None` when the selection is empty, holds no text, or isn't
/// supported here (e.g. a Wayland compositor without primary-selection
/// support) — the frontend falls back to the last in-app selection.
#[tauri::command(async)]
pub fn get_primary_selection(state: State<'_, PrimarySelectionState>) -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        use arboard::{GetExtLinux, LinuxClipboardKind};
        with_clipboard(&state, |c| {
            c.get().clipboard(LinuxClipboardKind::Primary).text()
        })
        .ok()
        .filter(|text| !text.is_empty())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = state;
        None
    }
}
