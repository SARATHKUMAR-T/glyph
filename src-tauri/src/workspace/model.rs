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
