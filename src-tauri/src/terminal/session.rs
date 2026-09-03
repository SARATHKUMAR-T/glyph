use std::io::Write;
use std::sync::{Arc, Mutex};

use portable_pty::{ChildKiller, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTerminalRequest {
    pub cols: u16,
    pub rows: u16,
    pub cwd: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeTerminalRequest {
    pub cols: u16,
    pub rows: u16,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionInfo {
    pub session_id: String,
    pub shell: String,
    pub cols: u16,
    pub rows: u16,
    pub cwd: Option<String>,
    pub pid: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseTerminalResponse {
    pub session_id: String,
    pub closed: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalErrorPayload {
    pub code: String,
    pub message: String,
}

#[allow(dead_code)]
#[derive(Debug, Error)]
pub enum TerminalError {
    #[error("Terminal session not found: {0}")]
    SessionNotFound(String),

    #[error("PTY creation failed: {0}")]
    PtyCreation(String),

    #[error("Unable to spawn shell '{shell}': {message}")]
    ShellSpawn { shell: String, message: String },

    #[error("Failed to read from PTY: {0}")]
    PtyRead(String),

    #[error("Failed to write to PTY: {0}")]
    PtyWrite(String),

    #[error("Failed to resize PTY: {0}")]
    PtyResize(String),

    #[error("Terminal size is invalid: {cols}x{rows}")]
    InvalidSize { cols: u16, rows: u16 },

    #[error("Requested working directory is invalid: {0}")]
    InvalidWorkingDirectory(String),

    #[error("Terminal state is unavailable")]
    StateUnavailable,

    #[error("Terminal child process could not be closed: {0}")]
    CloseFailed(String),
}

impl TerminalError {
    pub fn code(&self) -> &'static str {
        match self {
            TerminalError::SessionNotFound(_) => "session_not_found",
            TerminalError::PtyCreation(_) => "pty_creation_failed",
            TerminalError::ShellSpawn { .. } => "shell_spawn_failed",
            TerminalError::PtyRead(_) => "pty_read_failed",
            TerminalError::PtyWrite(_) => "pty_write_failed",
            TerminalError::PtyResize(_) => "pty_resize_failed",
            TerminalError::InvalidSize { .. } => "invalid_terminal_size",
            TerminalError::InvalidWorkingDirectory(_) => "invalid_working_directory",
            TerminalError::StateUnavailable => "state_unavailable",
            TerminalError::CloseFailed(_) => "close_failed",
        }
    }
}

impl From<TerminalError> for TerminalErrorPayload {
    fn from(error: TerminalError) -> Self {
        Self {
            code: error.code().to_string(),
            message: error.to_string(),
        }
    }
}

pub struct TerminalSession {
    pub id: String,
    pub shell: String,
    pub cwd: Option<String>,
    pub pid: Option<u32>,
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pub size: PtySize,
}

impl TerminalSession {
    pub fn info(&self) -> TerminalSessionInfo {
        TerminalSessionInfo {
            session_id: self.id.clone(),
            shell: self.shell.clone(),
            cols: self.size.cols,
            rows: self.size.rows,
            cwd: self.cwd.clone(),
            pid: self.pid,
        }
    }
}
