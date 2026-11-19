//! Registers a desktop-wide Ctrl+Alt+G shortcut that launches Glyph, the
//! way Ctrl+Alt+T launches the default terminal on Ubuntu.
//!
//! The quake-mode hotkey in `tray.rs` is an in-process global shortcut, so
//! it only works while Glyph is already running. A launcher shortcut has to
//! live in the desktop's own keybindings instead. On GNOME (and Ubuntu's
//! GNOME session) that is a "custom keybinding" under
//! `org.gnome.settings-daemon.plugins.media-keys`, which we write with the
//! `gsettings` CLI, the same entry Settings → Keyboard → Custom Shortcuts
//! creates.
//!
//! It runs once per user: a marker file in the app config dir records the
//! attempt, so a user who deletes or rebinds the shortcut doesn't get it
//! back on the next launch. An existing binding on Ctrl+Alt+G is never
//! overwritten.

use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::{App, Manager};

const MEDIA_KEYS_SCHEMA: &str = "org.gnome.settings-daemon.plugins.media-keys";
const CUSTOM_SCHEMA: &str = "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding";
const GLYPH_PATH: &str = "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/glyph/";
const BINDING: &str = "<Primary><Alt>g";
const MARKER_FILE: &str = "launch-shortcut-registered";

/// Called once from `lib.rs`'s `.setup()`. Does its work on a background
/// thread so the `gsettings` calls never delay the first window.
pub fn setup(app: &App) {
    let Ok(config_dir) = app.path().app_config_dir() else {
        return;
    };
    std::thread::spawn(move || {
        let marker = config_dir.join(MARKER_FILE);
        if marker.exists() {
            return;
        }
        match register() {
            Ok(Outcome::NotGnome) => {}
            Ok(outcome) => {
                tracing::info!("Ctrl+Alt+G launcher shortcut: {outcome:?}");
                write_marker(&config_dir, &marker);
            }
            Err(error) => tracing::warn!("could not register the Ctrl+Alt+G launcher shortcut: {error}"),
        }
    });
}

#[derive(Debug)]
enum Outcome {
    /// No GNOME media-keys schema (KDE, XFCE, ...), so nothing was done.
    /// No marker is written, in case the user later switches to GNOME.
    NotGnome,
    Registered,
    AlreadyRegistered,
    /// Ctrl+Alt+G is already bound to something else; left untouched.
    KeyTaken,
}

fn register() -> Result<Outcome, String> {
    match gsettings(&["list-schemas"]) {
        Ok(list) if list.lines().any(|line| line.trim() == MEDIA_KEYS_SCHEMA) => {}
        _ => return Ok(Outcome::NotGnome),
    }

    let current = gsettings(&["get", MEDIA_KEYS_SCHEMA, "custom-keybindings"])?;
    let mut paths = parse_path_list(&current);
    if paths.iter().any(|path| path == GLYPH_PATH) {
        return Ok(Outcome::AlreadyRegistered);
    }

    for path in &paths {
        let binding = gsettings(&["get", &format!("{CUSTOM_SCHEMA}:{path}"), "binding"]).unwrap_or_default();
        if unquote(&binding).eq_ignore_ascii_case(BINDING) {
            return Ok(Outcome::KeyTaken);
        }
    }

    let relocatable = format!("{CUSTOM_SCHEMA}:{GLYPH_PATH}");
    let command = launcher_command();
    gsettings(&["set", &relocatable, "name", &gvariant_string("Glyph")])?;
    gsettings(&["set", &relocatable, "command", &gvariant_string(&command)])?;
    gsettings(&["set", &relocatable, "binding", &gvariant_string(BINDING)])?;

    paths.push(GLYPH_PATH.to_string());
    let list = format!(
        "[{}]",
        paths.iter().map(|path| gvariant_string(path)).collect::<Vec<_>>().join(", ")
    );
    gsettings(&["set", MEDIA_KEYS_SCHEMA, "custom-keybindings", &list])?;
    Ok(Outcome::Registered)
}

/// What the shortcut runs: the AppImage itself when running from one
/// (`$APPIMAGE` is its real path; `current_exe` points into a temporary
/// mount), `glyph` when the .deb put it on PATH, else this binary.
fn launcher_command() -> String {
    if let Some(appimage) = std::env::var_os("APPIMAGE") {
        return shell_quote(&PathBuf::from(appimage));
    }
    if Path::new("/usr/bin/glyph").exists() {
        return "glyph".to_string();
    }
    std::env::current_exe()
        .map(|exe| shell_quote(&exe))
        .unwrap_or_else(|_| "glyph".to_string())
}

fn shell_quote(path: &Path) -> String {
    let text = path.to_string_lossy();
    if text.chars().all(|c| c.is_ascii_alphanumeric() || "/._-+".contains(c)) {
        text.into_owned()
    } else {
        format!("'{}'", text.replace('\'', r"'\''"))
    }
}

fn gsettings(args: &[&str]) -> Result<String, String> {
    let output = Command::new("gsettings")
        .args(args)
        .output()
        .map_err(|error| format!("gsettings {}: {error}", args.join(" ")))?;
    if !output.status.success() {
        return Err(format!(
            "gsettings {}: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Parses gsettings' printed `as` value: `@as []` or `['/a/', '/b/']`.
fn parse_path_list(value: &str) -> Vec<String> {
    let inner = value.trim().trim_start_matches("@as").trim();
    let inner = inner.trim_start_matches('[').trim_end_matches(']');
    inner
        .split(',')
        .map(|item| unquote(item.trim()).to_string())
        .filter(|item| !item.is_empty())
        .collect()
}

fn unquote(value: &str) -> &str {
    let value = value.trim();
    value
        .strip_prefix('\'')
        .and_then(|rest| rest.strip_suffix('\''))
        .or_else(|| value.strip_prefix('"').and_then(|rest| rest.strip_suffix('"')))
        .unwrap_or(value)
}

/// A GVariant string literal, as `gsettings set` expects it.
fn gvariant_string(value: &str) -> String {
    format!("'{}'", value.replace('\\', r"\\").replace('\'', r"\'"))
}

fn write_marker(config_dir: &Path, marker: &Path) {
    let _ = std::fs::create_dir_all(config_dir);
    if let Err(error) = std::fs::write(marker, b"Ctrl+Alt+G launcher shortcut set up once; delete this file to retry.\n") {
        tracing::warn!("could not write {}: {error}", marker.display());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_empty_and_filled_lists() {
        assert!(parse_path_list("@as []").is_empty());
        assert_eq!(
            parse_path_list("['/a/custom0/', '/a/glyph/']"),
            vec!["/a/custom0/".to_string(), "/a/glyph/".to_string()]
        );
    }

    #[test]
    fn quotes_gvariant_strings() {
        assert_eq!(gvariant_string("it's"), r"'it\'s'");
        assert_eq!(unquote("'<Primary><Alt>g'"), "<Primary><Alt>g");
    }
}
