//! The "quake mode" global hotkey (show/hide the main window from anywhere)
//! and the close-confirmation guard on the main window. There is no tray
//! icon and no close-to-tray: closing the window quits the app, after asking
//! first if any terminal still has a program running.
//!
//! Best-effort: a failing hotkey registration (the combo already bound by
//! another app, etc.) is logged and skipped rather than taking the app down.

use tauri::{App, AppHandle, Emitter, Manager, WindowEvent};

use crate::terminal::manager::TerminalManager;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const CONFIRM_CLOSE_EVENT: &str = "app://confirm-close";
const MAIN_WINDOW: &str = "main";

fn toggle_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    match window.is_visible() {
        Ok(true) => {
            let _ = window.hide();
        }
        _ => {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

fn register_quake_shortcut(app: &App) {
    let quake_shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Backquote);
    if let Err(error) = app.handle().plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                if event.state() == ShortcutState::Pressed && shortcut == &quake_shortcut {
                    toggle_main_window(app);
                }
            })
            .build(),
    ) {
        tracing::warn!("quake-mode global shortcut plugin failed to init: {error}");
        return;
    }
    if let Err(error) = app.global_shortcut().register(quake_shortcut) {
        tracing::warn!(
            "quake-mode global shortcut (Ctrl+Alt+`) could not be registered, likely already bound by another app: {error}"
        );
    }
}

/// Registers the quake-mode hotkey (Ctrl+Alt+` — `Backquote`, chosen to avoid
/// colliding with any of this app's own default keybindings) and guards the
/// main window's close. Called once from `lib.rs`'s `.setup()`.
pub fn setup(app: &App) {
    register_quake_shortcut(app);

    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let handle = app.handle().clone();
        window.on_window_event(move |event| {
            let WindowEvent::CloseRequested { api, .. } = event else {
                return;
            };
            // Running programs: hold the close and let the frontend ask.
            // Confirming calls `quit_app`, which kills every terminal.
            let running = handle.state::<TerminalManager>().running_process_count();
            if running > 0 {
                api.prevent_close();
                let _ = handle.emit(CONFIRM_CLOSE_EVENT, running);
            }
        });
    }
}
