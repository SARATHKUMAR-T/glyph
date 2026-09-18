mod commands;
mod events;
pub mod terminal;
mod tray;
mod workspace;

use commands::engine::{
    engine_attach_channel, engine_clear_selection, engine_feed_local, engine_scrollback_query,
    engine_search, engine_selection_range, engine_set_cursor_style, engine_set_palette,
    engine_set_scroll,
};
use commands::session::{clear_session, load_session, save_session};
use commands::system::{get_system_perf_stats, SystemMonitorState};
use commands::terminal::{
    close_terminal, create_terminal, get_terminal_cwd, list_sessions, open_url, resize_terminal,
    write_terminal,
};
use commands::workspace::{delete_workspace, get_workspace, get_workspaces, save_workspace};
use tauri::Manager;
use terminal::engine::EngineManager;
use terminal::manager::TerminalManager;
use workspace::manager::WorkspaceManager;

pub fn run() {
    let workspace_manager = WorkspaceManager::default();
    let ws_mgr_clone = workspace_manager.clone();

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .manage(TerminalManager::default())
        .manage(EngineManager::default())
        .manage(SystemMonitorState::default())
        .manage(workspace_manager)
        .invoke_handler(tauri::generate_handler![
            create_terminal,
            write_terminal,
            resize_terminal,
            close_terminal,
            list_sessions,
            get_terminal_cwd,
            open_url,
            get_system_perf_stats,
            get_workspaces,
            get_workspace,
            save_workspace,
            delete_workspace,
            engine_attach_channel,
            engine_scrollback_query,
            engine_set_scroll,
            engine_selection_range,
            engine_clear_selection,
            engine_search,
            engine_feed_local,
            engine_set_palette,
            engine_set_cursor_style,
            save_session,
            load_session,
            clear_session
        ])
        .setup(move |app| {
            if let Ok(app_dir) = app.path().app_data_dir() {
                let ws_dir = app_dir.join("workspaces");
                ws_mgr_clone.set_storage_dir(ws_dir);
                ws_mgr_clone.set_session_path(app_dir.join("session.json"));
            }
            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            tray::setup(app);
            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(error) = result {
        eprintln!("GLYPH Terminal failed to start: {error}");
    }
}
