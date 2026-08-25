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
    command.env("TERM_PROGRAM_VERSION", "0.1.0");
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

fn validate_cwd(cwd: Option<String>) -> Result<Option<String>, TerminalError> {
    match cwd {
        Some(path) if Path::new(&path).is_dir() => Ok(Some(path)),
        Some(path) => Err(TerminalError::InvalidWorkingDirectory(path)),
        None => Ok(None),
    }
}
