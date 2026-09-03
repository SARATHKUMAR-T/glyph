mod commands;
mod events;
mod terminal;
mod workspace;

use commands::system::{get_system_perf_stats, SystemMonitorState};
use commands::terminal::{
    close_terminal, create_terminal, get_terminal_cwd, list_sessions, open_url, resize_terminal,
    write_terminal,
};
use commands::workspace::{delete_workspace, get_workspace, get_workspaces, save_workspace};
use tauri::Manager;
use terminal::manager::TerminalManager;
use workspace::manager::WorkspaceManager;

pub fn run() {
    let workspace_manager = WorkspaceManager::default();
    let ws_mgr_clone = workspace_manager.clone();

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(TerminalManager::default())
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
            delete_workspace
        ])
        .setup(move |app| {
            if let Ok(app_dir) = app.path().app_data_dir() {
                let ws_dir = app_dir.join("workspaces");
                ws_mgr_clone.set_storage_dir(ws_dir);
            }
            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(error) = result {
        eprintln!("GLYPH Terminal failed to start: {error}");
    }
}
