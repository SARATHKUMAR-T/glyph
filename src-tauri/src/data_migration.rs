//! One-time move of the app's data directory after the bundle identifier
//! changed from `com.aximsoft.glyph` to `com.sarath.glyph`.
//!
//! Tauri names the data directory after the identifier, and on Linux that
//! one directory (`$XDG_DATA_HOME/<identifier>`) holds both the webview's
//! localStorage (settings, keybindings, workspace list) and the files
//! written by `app_data_dir()` (`session.json`, `workspaces/`). Without this
//! move, updating would silently reset all of that to defaults.
//!
//! Must run before `tauri::Builder` builds, because the `main` window from
//! tauri.conf.json (and with it WebKitGTK's storage) is already created by
//! the time `.setup()` runs.

use std::path::PathBuf;

const OLD_IDENTIFIER: &str = "com.aximsoft.glyph";
const NEW_IDENTIFIER: &str = "com.sarath.glyph";

/// Same base directory Tauri's `app_data_dir()` resolves against on Linux.
fn data_home() -> Option<PathBuf> {
    std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")))
}

/// Renames the old data directory to the new one, only when the old one
/// exists and the new one doesn't. A rename within the same parent is
/// atomic, so a crash can't leave half-moved data. Failures are logged and
/// never block startup: the worst case is the app starting with defaults.
pub fn migrate_legacy_data_dir() {
    if let Some(base) = data_home() {
        migrate_in(&base);
    }
}

fn migrate_in(base: &std::path::Path) {
    let old_dir = base.join(OLD_IDENTIFIER);
    let new_dir = base.join(NEW_IDENTIFIER);
    if !old_dir.is_dir() || new_dir.exists() {
        return;
    }
    match std::fs::rename(&old_dir, &new_dir) {
        Ok(()) => tracing::info!("migrated data dir {old_dir:?} -> {new_dir:?}"),
        Err(err) => tracing::warn!("could not migrate data dir {old_dir:?} -> {new_dir:?}: {err}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_base(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("glyph-migrate-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn moves_old_dir_when_new_is_absent() {
        let base = temp_base("move");
        std::fs::create_dir_all(base.join(OLD_IDENTIFIER).join("localstorage")).unwrap();
        std::fs::write(base.join(OLD_IDENTIFIER).join("session.json"), "{}").unwrap();

        migrate_in(&base);

        assert!(!base.join(OLD_IDENTIFIER).exists());
        assert!(base.join(NEW_IDENTIFIER).join("localstorage").is_dir());
        assert_eq!(
            std::fs::read_to_string(base.join(NEW_IDENTIFIER).join("session.json")).unwrap(),
            "{}"
        );
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn leaves_existing_new_dir_untouched() {
        let base = temp_base("keep");
        std::fs::create_dir_all(base.join(OLD_IDENTIFIER)).unwrap();
        std::fs::create_dir_all(base.join(NEW_IDENTIFIER)).unwrap();
        std::fs::write(base.join(NEW_IDENTIFIER).join("session.json"), "new").unwrap();

        migrate_in(&base);

        assert!(base.join(OLD_IDENTIFIER).is_dir());
        assert_eq!(
            std::fs::read_to_string(base.join(NEW_IDENTIFIER).join("session.json")).unwrap(),
            "new"
        );
        std::fs::remove_dir_all(&base).unwrap();
    }
}
