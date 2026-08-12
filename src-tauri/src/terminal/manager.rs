use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;

use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::events::terminal_events::{
    TerminalErrorEvent, TerminalExitEvent, TerminalStateEvent, ERROR_EVENT, EXIT_EVENT, STATE_EVENT,
};

use super::pty::spawn_shell;
use super::reader::{spawn_reader_thread, timestamp_millis};
use super::resize::validated_size;
use super::session::{
    CloseTerminalResponse, CreateTerminalRequest, ResizeTerminalRequest, TerminalError,
    TerminalSession, TerminalSessionInfo,
};
use super::writer;

#[derive(Clone, Default)]
pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
}

impl TerminalManager {
    pub fn create_terminal(
        &self,
        app: AppHandle,
        request: CreateTerminalRequest,
    ) -> Result<TerminalSessionInfo, TerminalError> {
        let session_id = Uuid::new_v4().to_string();
        let spawned = spawn_shell(&session_id, request)?;
        let killer = spawned.child.clone_killer();
        let writer = Arc::new(Mutex::new(spawned.writer));
        let session = TerminalSession {
            id: session_id.clone(),
            shell: spawned.shell.clone(),
            cwd: spawned.cwd.clone(),
            master: spawned.master,
            writer: Arc::clone(&writer),
            killer: Mutex::new(killer),
            size: spawned.size,
        };
        let info = session.info();

        self.sessions
            .lock()
            .map_err(|_| TerminalError::StateUnavailable)?
            .insert(session_id.clone(), session);

        spawn_reader_thread(
            app.clone(),
            session_id.clone(),
            spawned.reader,
            Arc::clone(&self.sessions),
        );
        self.spawn_wait_thread(app.clone(), session_id.clone(), spawned.child);

        let _ = app.emit(
            STATE_EVENT,
            TerminalStateEvent {
                session_id,
                state: "running".to_string(),
                timestamp: timestamp_millis(),
            },
        );

        Ok(info)
    }

    pub fn write_terminal(&self, session_id: &str, bytes: &[u8]) -> Result<(), TerminalError> {
        let writer = {
            let sessions = self
                .sessions
                .lock()
                .map_err(|_| TerminalError::StateUnavailable)?;
            let session = sessions
                .get(session_id)
                .ok_or_else(|| TerminalError::SessionNotFound(session_id.to_string()))?;
            Arc::clone(&session.writer)
        };

        writer::write_all(&writer, bytes)
    }

    pub fn resize_terminal(
        &self,
        session_id: &str,
        request: ResizeTerminalRequest,
    ) -> Result<(), TerminalError> {
        let size = validated_size(request.cols, request.rows)?;
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| TerminalError::StateUnavailable)?;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| TerminalError::SessionNotFound(session_id.to_string()))?;

        session
            .master
            .resize(size)
            .map_err(|error| TerminalError::PtyResize(error.to_string()))?;
        session.size = size;
        Ok(())
    }

    pub fn close_terminal(&self, session_id: &str) -> Result<CloseTerminalResponse, TerminalError> {
        let session = self
            .sessions
            .lock()
            .map_err(|_| TerminalError::StateUnavailable)?
            .remove(session_id);

        let Some(session) = session else {
            return Err(TerminalError::SessionNotFound(session_id.to_string()));
        };

        session
            .killer
            .lock()
            .map_err(|_| TerminalError::StateUnavailable)?
            .kill()
            .map_err(|error| TerminalError::CloseFailed(error.to_string()))?;

        Ok(CloseTerminalResponse {
            session_id: session_id.to_string(),
            closed: true,
        })
    }

    pub fn list_sessions(&self) -> Result<Vec<TerminalSessionInfo>, TerminalError> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| TerminalError::StateUnavailable)?;

        Ok(sessions.values().map(TerminalSession::info).collect())
    }

    fn spawn_wait_thread(
        &self,
        app: AppHandle,
        session_id: String,
        mut child: Box<dyn portable_pty::Child + Send + Sync>,
    ) {
        let sessions = Arc::clone(&self.sessions);
        thread::spawn(move || {
            let status = child.wait();
            if let Ok(mut sessions) = sessions.lock() {
                sessions.remove(&session_id);
            }

            match status {
                Ok(status) => {
                    let _ = app.emit(
                        EXIT_EVENT,
                        TerminalExitEvent {
                            session_id: session_id.clone(),
                            exit_code: Some(status.exit_code()),
                            signal: status.signal().map(str::to_string),
                        },
                    );
                    let _ = app.emit(
                        STATE_EVENT,
                        TerminalStateEvent {
                            session_id,
                            state: "exited".to_string(),
                            timestamp: timestamp_millis(),
                        },
                    );
                }
                Err(error) => {
                    let _ = app.emit(
                        ERROR_EVENT,
                        TerminalErrorEvent {
                            session_id: Some(session_id),
                            code: "child_wait_failed".to_string(),
                            message: error.to_string(),
                        },
                    );
                }
            }
        });
    }
}
