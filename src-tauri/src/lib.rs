mod commands;
mod events;
mod terminal;

use commands::terminal::{close_terminal, create_terminal, list_sessions, resize_terminal, write_terminal};
use terminal::manager::TerminalManager;

pub fn run() {
    let result = tauri::Builder::default()
        .manage(TerminalManager::default())
        .invoke_handler(tauri::generate_handler![
            create_terminal,
            write_terminal,
            resize_terminal,
            close_terminal,
            list_sessions
        ])
        .setup(|_app| {
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                if let Some(window) = _app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(error) = result {
        eprintln!("Nothing Terminal failed to start: {error}");
    }
}
