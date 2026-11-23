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
//! It runs on every start, so it can repair what it set up earlier:
//!
//! - Our entry exists: if its command no longer points at an existing
//!   executable (an AppImage that was moved or renamed, a .deb that was
//!   removed), it is pointed at this copy of Glyph. A command the user
//!   edited to something that still exists is left alone, and so is the
//!   key binding.
//! - Our entry is gone after we registered it: the user removed it, so it
//!   stays removed. A marker file in the app config dir records that we
//!   registered it once.
//! - Ctrl+Alt+G is already bound to another custom shortcut: nothing is
//!   overwritten, a warning names that shortcut, and Glyph tries again on
//!   the next start in case the key has been freed.
//!
//! `gsettings` runs with the AppImage's GLib/GTK overrides removed from its
//! environment, so it talks to the desktop's real settings backend and
//! schemas instead of the ones bundled inside the AppImage.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::{App, Manager};

const MEDIA_KEYS_SCHEMA: &str = "org.gnome.settings-daemon.plugins.media-keys";
const CUSTOM_SCHEMA: &str = "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding";
const GLYPH_PATH: &str = "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/glyph/";
const BINDING: &str = "<Primary><Alt>g";
/// Written once our shortcut is in place. v0.8.2 wrote `OLD_MARKER_FILE`
/// even when Ctrl+Alt+G was taken and nothing was registered, so that file
/// can't tell "the user removed it" apart from "never registered"; it is
/// replaced by this one.
const MARKER_FILE: &str = "launch-shortcut-v2";
const OLD_MARKER_FILE: &str = "launch-shortcut-registered";

/// Environment variables an AppImage (linuxdeploy's GTK hook) points at its
/// own bundled copies. A `gsettings` from the host must not inherit them.
const APPIMAGE_ENV_OVERRIDES: &[&str] = &[
    "GSETTINGS_SCHEMA_DIR",
    "GIO_EXTRA_MODULES",
    "GIO_MODULE_DIR",
    "GI_TYPELIB_PATH",
    "GTK_DATA_PREFIX",
    "GTK_EXE_PREFIX",
    "GTK_PATH",
    "GTK_IM_MODULE_FILE",
    "GDK_PIXBUF_MODULE_FILE",
    "LD_LIBRARY_PATH",
    "LD_PRELOAD",
];

/// Called once from `lib.rs`'s `.setup()`. Does its work on a background
/// thread so the `gsettings` calls never delay the first window.
pub fn setup(app: &App) {
    let Ok(config_dir) = app.path().app_config_dir() else {
        return;
    };
    std::thread::spawn(move || {
        let _ = std::fs::remove_file(config_dir.join(OLD_MARKER_FILE));
        let marker = config_dir.join(MARKER_FILE);
        match register(marker.exists()) {
            Ok(Outcome::NotGnome) => {}
            Ok(Outcome::InPlace) => {
                // Also covers an entry made by v0.8.2 before this marker existed.
                if !marker.exists() {
                    write_marker(&config_dir, &marker);
                }
            }
            Ok(Outcome::Registered) => {
                tracing::info!("Ctrl+Alt+G launcher shortcut registered");
                write_marker(&config_dir, &marker);
            }
            Ok(Outcome::Repaired { old_command, new_command }) => {
                tracing::info!("Ctrl+Alt+G launcher shortcut pointed at {old_command:?}, which is gone; now runs {new_command:?}");
                write_marker(&config_dir, &marker);
            }
            Ok(Outcome::RemovedByUser) => {
                tracing::debug!("Ctrl+Alt+G launcher shortcut was removed by the user; leaving it removed");
            }
            Ok(Outcome::KeyTaken { name, command }) => tracing::warn!(
                "Ctrl+Alt+G is already the custom shortcut {name:?} (runs {command:?}), so Glyph didn't add its \
                 launcher shortcut. Free the key in Settings → Keyboard → Custom Shortcuts and restart Glyph."
            ),
            Err(error) => tracing::warn!("could not register the Ctrl+Alt+G launcher shortcut: {error}"),
        }
    });
}

#[derive(Debug)]
enum Outcome {
    /// No GNOME media-keys schema (KDE, XFCE, ...), so nothing was done.
    NotGnome,
    Registered,
    /// Our entry is there and its command still points at something that exists.
    InPlace,
    /// Our entry is there but its command pointed at a missing executable.
    Repaired {
        old_command: String,
        new_command: String,
    },
    /// We registered it before and it is gone now: the user removed it.
    RemovedByUser,
    /// Ctrl+Alt+G is already bound to another custom shortcut; left untouched.
    KeyTaken {
        name: String,
        command: String,
    },
}

fn register(registered_before: bool) -> Result<Outcome, String> {
    match gsettings(&["list-schemas"]) {
        Ok(list) if list.lines().any(|line| line.trim() == MEDIA_KEYS_SCHEMA) => {}
        _ => return Ok(Outcome::NotGnome),
    }

    let relocatable = format!("{CUSTOM_SCHEMA}:{GLYPH_PATH}");
    let current = gsettings(&["get", MEDIA_KEYS_SCHEMA, "custom-keybindings"])?;
    let mut paths = parse_path_list(&current);

    if paths.iter().any(|path| path == GLYPH_PATH) {
        let old_command = unquote(&gsettings(&["get", &relocatable, "command"])?).to_string();
        if !old_command.is_empty() && command_exists(&old_command) {
            return Ok(Outcome::InPlace);
        }
        let new_command = launcher_command();
        if old_command.is_empty() {
            // Half-written entry (listed, but its fields were never set).
            write_entry(&relocatable, &new_command)?;
        } else {
            gsettings(&[
                "set",
                &relocatable,
                "command",
                &gvariant_string(&new_command),
            ])?;
        }
        return Ok(Outcome::Repaired {
            old_command,
            new_command,
        });
    }

    if registered_before {
        return Ok(Outcome::RemovedByUser);
    }

    for path in &paths {
        let schema = format!("{CUSTOM_SCHEMA}:{path}");
        let binding = gsettings(&["get", &schema, "binding"]).unwrap_or_default();
        if unquote(&binding).eq_ignore_ascii_case(BINDING) {
            let name = gsettings(&["get", &schema, "name"]).unwrap_or_default();
            let command = gsettings(&["get", &schema, "command"]).unwrap_or_default();
            return Ok(Outcome::KeyTaken {
                name: unquote(&name).to_string(),
                command: unquote(&command).to_string(),
            });
        }
    }

    write_entry(&relocatable, &launcher_command())?;
    paths.push(GLYPH_PATH.to_string());
    let list = format!(
        "[{}]",
        paths
            .iter()
            .map(|path| gvariant_string(path))
            .collect::<Vec<_>>()
            .join(", ")
    );
    gsettings(&["set", MEDIA_KEYS_SCHEMA, "custom-keybindings", &list])?;
    Ok(Outcome::Registered)
}

fn write_entry(relocatable: &str, command: &str) -> Result<(), String> {
    gsettings(&["set", relocatable, "name", &gvariant_string("Glyph")])?;
    gsettings(&["set", relocatable, "command", &gvariant_string(command)])?;
    gsettings(&["set", relocatable, "binding", &gvariant_string(BINDING)])?;
    Ok(())
}

/// Whether the program a shortcut command runs still exists: an absolute
/// path that is a file, or a bare name found on PATH.
fn command_exists(command: &str) -> bool {
    let Some(program) = first_word(command) else {
        return false;
    };
    if program.contains('/') {
        return Path::new(&program).is_file();
    }
    std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).any(|dir| dir.join(&program).is_file()))
        .unwrap_or(false)
}

/// The first word of a shell command, with `'...'` quoting (and the
/// `'\''` escape `shell_quote` produces) undone.
fn first_word(command: &str) -> Option<String> {
    let mut word = String::new();
    let mut chars = command.trim_start().chars().peekable();
    let mut in_quotes = false;
    while let Some(c) = chars.next() {
        match c {
            '\'' => in_quotes = !in_quotes,
            '\\' if !in_quotes => word.extend(chars.next()),
            c if c.is_whitespace() && !in_quotes => break,
            c => word.push(c),
        }
    }
    (!word.is_empty()).then_some(word)
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
    if text
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "/._-+".contains(c))
    {
        text.into_owned()
    } else {
        format!("'{}'", text.replace('\'', r"'\''"))
    }
}

fn gsettings(args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("gsettings");
    command.args(args);
    host_environment(&mut command);
    let output = command
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

/// Undoes the AppImage's environment overrides for a child process, so it
/// uses the host's GLib, schemas and dconf backend. A no-op outside an
/// AppImage, where none of these point into `$APPDIR`.
fn host_environment(command: &mut Command) {
    let Some(appdir) = std::env::var_os("APPDIR").filter(|dir| !dir.is_empty()) else {
        return;
    };
    for name in APPIMAGE_ENV_OVERRIDES {
        command.env_remove(name);
    }
    if let Some(data_dirs) = std::env::var_os("XDG_DATA_DIRS") {
        command.env(
            "XDG_DATA_DIRS",
            strip_appdir(&data_dirs, Path::new(&appdir)),
        );
    }
}

/// Drops the entries of a `:`-separated path list that live inside `appdir`.
fn strip_appdir(list: &OsString, appdir: &Path) -> OsString {
    let kept: Vec<PathBuf> = std::env::split_paths(list)
        .filter(|dir| !dir.as_os_str().is_empty() && !dir.starts_with(appdir))
        .collect();
    std::env::join_paths(kept).unwrap_or_default()
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
        .or_else(|| {
            value
                .strip_prefix('"')
                .and_then(|rest| rest.strip_suffix('"'))
        })
        .unwrap_or(value)
}

/// A GVariant string literal, as `gsettings set` expects it.
fn gvariant_string(value: &str) -> String {
    format!("'{}'", value.replace('\\', r"\\").replace('\'', r"\'"))
}

fn write_marker(config_dir: &Path, marker: &Path) {
    let _ = std::fs::create_dir_all(config_dir);
    if let Err(error) = std::fs::write(
        marker,
        b"Ctrl+Alt+G launcher shortcut set up once; delete this file to retry.\n",
    ) {
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

    #[test]
    fn reads_the_program_of_a_shortcut_command() {
        assert_eq!(first_word("glyph").as_deref(), Some("glyph"));
        assert_eq!(
            first_word("/opt/Glyph.AppImage --new").as_deref(),
            Some("/opt/Glyph.AppImage")
        );
        let quoted = shell_quote(Path::new("/home/me/My Apps/it's Glyph.AppImage"));
        assert_eq!(
            first_word(&quoted).as_deref(),
            Some("/home/me/My Apps/it's Glyph.AppImage")
        );
        assert_eq!(first_word("   "), None);
    }

    #[test]
    fn a_missing_program_is_stale() {
        assert!(command_exists("/bin/sh -c true"));
        assert!(command_exists("sh"));
        assert!(!command_exists("/nonexistent/Glyph_0.8.2_amd64.AppImage"));
        assert!(!command_exists("no-such-program-glyph-test"));
        assert!(!command_exists(""));
    }

    #[test]
    fn strips_appimage_entries_from_data_dirs() {
        let list = OsString::from("/tmp/.mount_Glyph1/usr/share:/usr/share::/usr/local/share");
        assert_eq!(
            strip_appdir(&list, Path::new("/tmp/.mount_Glyph1")),
            OsString::from("/usr/share:/usr/local/share")
        );
    }
}
