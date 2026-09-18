use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum CommandConfig {
    Raw(String),
    Structured { program: String, args: Vec<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePaneConfig {
    pub id: String,
    pub name: String,
    pub cwd: Option<String>,
    pub command: Option<CommandConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum WorkspaceLayoutNode {
    Pane {
        #[serde(rename = "paneId")]
        pane_id: String,
    },
    Split {
        id: String,
        direction: String, // "vertical" | "horizontal"
        ratio: f64,
        children: Vec<WorkspaceLayoutNode>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub layout: WorkspaceLayoutNode,
    pub panes: Vec<WorkspacePaneConfig>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// One open tab's layout, for the auto-saved session (see `Session`) —
/// shaped identically to `Workspace`'s `layout`/`panes` pair (reusing the
/// exact same `WorkspaceLayoutNode`/`WorkspacePaneConfig` types and the
/// frontend's existing `splitNodeToWorkspaceLayout`/`workspaceLayoutToSplitNode`
/// converters) since a tab's structure is the same shape as a named
/// workspace's — the only real difference is *how* it gets saved
/// (automatically, on every structural change, rather than by explicit
/// user action).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionTab {
    pub title: String,
    pub layout: WorkspaceLayoutNode,
    pub panes: Vec<WorkspacePaneConfig>,
}

/// The whole window's open tabs, auto-saved on every structural change
/// (new/closed tab, split, pane CWD change) and restored on the next
/// launch — separate from user-named `Workspace`s, which are saved only
/// by explicit action and never overwritten automatically. Stored as a
/// single `session.json` file (see `WorkspaceManager::save_session`), not
/// alongside the per-workspace files in the `workspaces/` directory, so it
/// never appears in the user-facing workspace list.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub tabs: Vec<SessionTab>,
    pub active_tab_index: usize,
    pub saved_at: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceErrorPayload {
    pub code: String,
    pub message: String,
}

#[allow(dead_code)]
#[derive(Debug, Error)]
pub enum WorkspaceError {
    #[error("Workspace not found: {0}")]
    NotFound(String),

    #[error("Invalid workspace configuration: {0}")]
    Validation(String),

    #[error("Storage error: {0}")]
    Storage(String),

    #[error("Duplicate workspace ID: {0}")]
    DuplicateId(String),

    #[error("Duplicate pane ID: {0}")]
    DuplicatePaneId(String),
}

impl WorkspaceError {
    pub fn code(&self) -> &'static str {
        match self {
            WorkspaceError::NotFound(_) => "workspace_not_found",
            WorkspaceError::Validation(_) => "validation_failed",
            WorkspaceError::Storage(_) => "storage_failed",
            WorkspaceError::DuplicateId(_) => "duplicate_id",
            WorkspaceError::DuplicatePaneId(_) => "duplicate_pane_id",
        }
    }
}

impl From<WorkspaceError> for WorkspaceErrorPayload {
    fn from(error: WorkspaceError) -> Self {
        Self {
            code: error.code().to_string(),
            message: error.to_string(),
        }
    }
}
