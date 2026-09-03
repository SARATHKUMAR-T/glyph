use std::env;
use std::io::{Read, Write};
use std::path::Path;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

use super::session::{CreateTerminalRequest, TerminalError};

pub struct SpawnedPty {
    pub shell: String,
    pub cwd: Option<String>,
    pub pid: Option<u32>,
    pub master: Box<dyn MasterPty + Send>,
    pub reader: Box<dyn Read + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn Child + Send + Sync>,
    pub size: PtySize,
}

pub fn spawn_shell(session_id: &str, request: CreateTerminalRequest) -> Result<SpawnedPty, TerminalError> {
    let shell = detect_shell();
    let cwd = validate_cwd(request.cwd)?;
    let size = super::resize::validated_size(request.cols, request.rows)?;
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(size)
        .map_err(|error| TerminalError::PtyCreation(error.to_string()))?;

    let mut command = CommandBuilder::new(&shell);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("LANG", "en_US.UTF-8");
    command.env("LC_ALL", "en_US.UTF-8");
    command.env("LC_CTYPE", "en_US.UTF-8");
    command.env("TERM_PROGRAM", "Glyph");
    command.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
    command.env("GLYPH_TERMINAL", "1");
    command.env("GLYPH_TERMINAL_SESSION", session_id);

    if let Some(cwd) = cwd.as_ref() {
        command.cwd(cwd);
    }

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| TerminalError::ShellSpawn {
            shell: shell.clone(),
            message: error.to_string(),
        })?;

    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| TerminalError::PtyRead(error.to_string()))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| TerminalError::PtyWrite(error.to_string()))?;

    let pid = child.process_id();

    Ok(SpawnedPty {
        shell,
        cwd,
        pid,
        master: pair.master,
        reader,
        writer,
        child,
        size,
    })
}

pub fn detect_shell() -> String {
    env::var("SHELL")
        .ok()
        .filter(|shell| Path::new(shell).is_file())
        .unwrap_or_else(|| "/bin/bash".to_string())
}

fn expand_tilde(path_str: &str) -> String {
    if path_str == "~" || path_str.starts_with("~/") {
        if let Ok(home) = env::var("HOME") {
            if path_str == "~" {
                return home;
            } else {
                return format!("{}{}", home, &path_str[1..]);
            }
        }
    }
    path_str.to_string()
}

fn validate_cwd(cwd: Option<String>) -> Result<Option<String>, TerminalError> {
    let Some(raw_path) = cwd else {
        return Ok(None);
    };

    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let expanded = expand_tilde(trimmed);
    let path = Path::new(&expanded);

    if path.is_dir() {
        Ok(Some(expanded))
    } else {
        if let Ok(home) = env::var("HOME") {
            let home_path = Path::new(&home);
            if home_path.is_dir() {
                return Ok(Some(home));
            }
        }
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_expand_tilde() {
        if let Ok(home) = env::var("HOME") {
            assert_eq!(expand_tilde("~"), home);
            assert_eq!(expand_tilde("~/Desktop"), format!("{home}/Desktop"));
        }
        assert_eq!(expand_tilde("/var/log"), "/var/log");
    }

    #[test]
    fn test_validate_cwd_handles_tilde_and_non_existent() {
        let result = validate_cwd(Some("~/Desktop".to_string())).unwrap();
        assert!(result.is_some());

        // Non-existent directory should fall back to HOME cleanly instead of crashing
        let fallback = validate_cwd(Some("~/non_existent_folder_xyz_123".to_string())).unwrap();
        assert!(fallback.is_some());
    }
}
