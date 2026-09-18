//! System tray icon and the "quake mode" global hotkey, both centered on
//! one idea: the main window can be hidden (not closed) and summoned back
//! from anywhere. Closing the main window's titlebar button hides it
//! instead of quitting the process — quitting for real only happens via
//! the tray menu's "Quit" item — so the global hotkey always has a window
//! to show, even after the user "closed" it.
//!
//! Every piece here is best-effort and independently optional: a tray
//! icon, menu, or global-hotkey registration failing (no display server
//! tray protocol, the combo already bound by another app, etc.) is logged
//! and skipped rather than taking the whole app down via `.setup()`'s `?`.
//! Close-to-tray is only wired up when the tray icon itself is confirmed
//! built — otherwise hiding the window on close with no tray (and possibly
//! no working hotkey either) would trap the user with no way to get it
//! back short of restarting the app.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{App, AppHandle, Manager, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

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

fn build_tray(app: &App) -> tauri::Result<()> {
    let show_hide = MenuItem::with_id(app, "show_hide", "Show/Hide Glyph", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Glyph", true, None::<&str>)?;
    let tray_menu = Menu::with_items(app, &[&show_hide, &quit])?;

    let icon = app.default_window_icon().cloned().ok_or_else(|| {
        tauri::Error::AssetNotFound("default window icon (needed for the tray icon)".into())
    })?;

    TrayIconBuilder::new()
        .icon(icon)
        .menu(&tray_menu)
        .show_menu_on_left_click(true)
        .tooltip("Glyph")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show_hide" => toggle_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
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

/// Wires up the tray icon (Show/Hide + Quit), the quake-mode global hotkey
/// (Ctrl+Alt+` — `Backquote`, chosen to avoid colliding with any of this
/// app's own default keybindings, all of which use Ctrl+Shift+<letter> or
/// plain Tab), and close-to-tray on the main window. Called once from
/// `lib.rs`'s `.setup()`; never fails the app's own startup.
pub fn setup(app: &App) {
    let tray_built = match build_tray(app) {
        Ok(()) => true,
        Err(error) => {
            tracing::warn!("tray icon setup failed, quake mode will close normally instead of minimizing: {error}");
            false
        }
    };

    register_quake_shortcut(app);

    if tray_built {
        if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
            let handle = app.handle().clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if let Some(window) = handle.get_webview_window(MAIN_WINDOW) {
                        let _ = window.hide();
                    }
                }
            });
        }
    }
}
