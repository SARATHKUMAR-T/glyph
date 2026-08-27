use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use uuid::Uuid;

use super::model::{Workspace, WorkspaceError, WorkspaceLayoutNode};

#[derive(Clone, Default)]
pub struct WorkspaceManager {
    storage_dir: Arc<Mutex<Option<PathBuf>>>,
    memory_cache: Arc<Mutex<HashMap<String, Workspace>>>,
}

impl WorkspaceManager {
    #[allow(dead_code)]
    pub fn new(storage_dir: PathBuf) -> Self {
        let manager = Self {
            storage_dir: Arc::new(Mutex::new(Some(storage_dir))),
            memory_cache: Arc::new(Mutex::new(HashMap::new())),
        };
        let _ = manager.reload_from_disk();
        manager
    }

    pub fn set_storage_dir(&self, dir: PathBuf) {
        if let Ok(mut storage) = self.storage_dir.lock() {
            *storage = Some(dir);
        }
        let _ = self.reload_from_disk();
    }

    fn get_storage_dir(&self) -> Result<PathBuf, WorkspaceError> {
        let storage = self
            .storage_dir
            .lock()
            .map_err(|_| WorkspaceError::Storage("Lock error".to_string()))?;
        let dir = storage.clone().ok_or_else(|| {
            WorkspaceError::Storage("Storage directory not set".to_string())
        })?;
        if !dir.exists() {
            fs::create_dir_all(&dir)
                .map_err(|e| WorkspaceError::Storage(format!("Failed to create directory: {e}")))?;
        }
        Ok(dir)
    }

    pub fn reload_from_disk(&self) -> Result<(), WorkspaceError> {
        let dir = match self.get_storage_dir() {
            Ok(d) => d,
            Err(_) => return Ok(()),
        };

        let mut loaded = HashMap::new();
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("json") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        if let Ok(ws) = serde_json::from_str::<Workspace>(&content) {
                            if self.validate_workspace(&ws).is_ok() {
                                loaded.insert(ws.id.clone(), ws);
                            }
                        }
                    }
                }
            }
        }

        if let Ok(mut cache) = self.memory_cache.lock() {
            *cache = loaded;
        }

        Ok(())
    }

    pub fn list_workspaces(&self) -> Result<Vec<Workspace>, WorkspaceError> {
        let cache = self
            .memory_cache
            .lock()
            .map_err(|_| WorkspaceError::Storage("Lock error".to_string()))?;
        let mut list: Vec<Workspace> = cache.values().cloned().collect();
        list.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(list)
    }

    pub fn get_workspace(&self, id: &str) -> Result<Workspace, WorkspaceError> {
        let cache = self
            .memory_cache
            .lock()
            .map_err(|_| WorkspaceError::Storage("Lock error".to_string()))?;
        cache
            .get(id)
            .cloned()
            .ok_or_else(|| WorkspaceError::NotFound(id.to_string()))
    }

    pub fn save_workspace(&self, mut workspace: Workspace) -> Result<Workspace, WorkspaceError> {
        if workspace.id.trim().is_empty() {
            workspace.id = Uuid::new_v4().to_string();
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        if workspace.created_at == 0 {
            workspace.created_at = now;
        }
        workspace.updated_at = now;

        self.validate_workspace(&workspace)?;

        let dir = self.get_storage_dir()?;
        let file_path = dir.join(format!("{}.json", workspace.id));
        let json_data = serde_json::to_string_pretty(&workspace)
            .map_err(|e| WorkspaceError::Storage(format!("Serialization error: {e}")))?;

        fs::write(&file_path, json_data)
            .map_err(|e| WorkspaceError::Storage(format!("File write error: {e}")))?;

        if let Ok(mut cache) = self.memory_cache.lock() {
            cache.insert(workspace.id.clone(), workspace.clone());
        }

        Ok(workspace)
    }

    pub fn delete_workspace(&self, id: &str) -> Result<(), WorkspaceError> {
        let dir = self.get_storage_dir()?;
        let file_path = dir.join(format!("{id}.json"));

        if file_path.exists() {
            fs::remove_file(file_path)
                .map_err(|e| WorkspaceError::Storage(format!("File delete error: {e}")))?;
        }

        if let Ok(mut cache) = self.memory_cache.lock() {
            cache.remove(id);
        }

        Ok(())
    }

    pub fn validate_workspace(&self, workspace: &Workspace) -> Result<(), WorkspaceError> {
        if workspace.name.trim().is_empty() {
            return Err(WorkspaceError::Validation(
                "Workspace name cannot be empty".to_string(),
            ));
        }

        let mut pane_ids = HashSet::new();
        for pane in &workspace.panes {
            if pane.id.trim().is_empty() {
                return Err(WorkspaceError::Validation(
                    "Pane ID cannot be empty".to_string(),
                ));
            }
            if !pane_ids.insert(pane.id.clone()) {
                return Err(WorkspaceError::DuplicatePaneId(pane.id.clone()));
            }
        }

        let mut referenced_panes = HashSet::new();
        self.validate_layout_node(&workspace.layout, &pane_ids, &mut referenced_panes)?;

        if referenced_panes.len() != pane_ids.len() {
            return Err(WorkspaceError::Validation(
                "Unreferenced pane definitions in workspace layout".to_string(),
            ));
        }

        Ok(())
    }

    fn validate_layout_node(
        &self,
        node: &WorkspaceLayoutNode,
        valid_pane_ids: &HashSet<String>,
        referenced_panes: &mut HashSet<String>,
    ) -> Result<(), WorkspaceError> {
        match node {
            WorkspaceLayoutNode::Pane { pane_id } => {
                if !valid_pane_ids.contains(pane_id) {
                    return Err(WorkspaceError::Validation(format!(
                        "Layout references undefined pane ID: {pane_id}"
                    )));
                }
                if !referenced_panes.insert(pane_id.clone()) {
                    return Err(WorkspaceError::Validation(format!(
                        "Pane ID '{pane_id}' referenced multiple times in layout tree"
                    )));
                }
                Ok(())
            }
            WorkspaceLayoutNode::Split {
                children,
                direction,
                ratio,
                ..
            } => {
                if direction != "vertical" && direction != "horizontal" {
                    return Err(WorkspaceError::Validation(format!(
                        "Invalid split direction: {direction}"
                    )));
                }
                if *ratio < 0.05 || *ratio > 0.95 {
                    return Err(WorkspaceError::Validation(format!(
                        "Invalid split ratio: {ratio}"
                    )));
                }
                if children.len() != 2 {
                    return Err(WorkspaceError::Validation(
                        "Split node must have exactly 2 children".to_string(),
                    ));
                }
                self.validate_layout_node(&children[0], valid_pane_ids, referenced_panes)?;
                self.validate_layout_node(&children[1], valid_pane_ids, referenced_panes)?;
                Ok(())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::model::{CommandConfig, WorkspacePaneConfig};
    use std::path::PathBuf;

    fn temp_test_dir() -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("glyph-test-ws-{}", Uuid::new_v4()));
        let _ = std::fs::create_dir_all(&p);
        p
    }

    fn sample_workspace() -> Workspace {
        Workspace {
            id: "test-ws-1".to_string(),
            name: "Test Workspace".to_string(),
            description: Some("Sample test workspace".to_string()),
            layout: WorkspaceLayoutNode::Split {
                id: "split-1".to_string(),
                direction: "vertical".to_string(),
                ratio: 0.5,
                children: vec![
                    WorkspaceLayoutNode::Pane {
                        pane_id: "pane-1".to_string(),
                    },
                    WorkspaceLayoutNode::Pane {
                        pane_id: "pane-2".to_string(),
                    },
                ],
            },
            panes: vec![
                WorkspacePaneConfig {
                    id: "pane-1".to_string(),
                    name: "Frontend".to_string(),
                    cwd: Some("/home/user/projects/frontend".to_string()),
                    command: Some(CommandConfig::Structured {
                        program: "npm".to_string(),
                        args: vec!["run".to_string(), "dev".to_string()],
                    }),
                },
                WorkspacePaneConfig {
                    id: "pane-2".to_string(),
                    name: "Backend".to_string(),
                    cwd: Some("/home/user/projects/backend".to_string()),
                    command: Some(CommandConfig::Raw("cargo run".to_string())),
                },
            ],
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn test_save_list_load_delete_workspace() {
        let dir = temp_test_dir();
        let manager = WorkspaceManager::new(dir);

        let ws = sample_workspace();
        let saved = manager.save_workspace(ws.clone()).unwrap();
        assert_eq!(saved.id, "test-ws-1");

        let list = manager.list_workspaces().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Test Workspace");

        let loaded = manager.get_workspace("test-ws-1").unwrap();
        assert_eq!(loaded.panes.len(), 2);
        assert_eq!(loaded.panes[0].name, "Frontend");

        manager.delete_workspace("test-ws-1").unwrap();
        let list_after = manager.list_workspaces().unwrap();
        assert_eq!(list_after.len(), 0);
    }

    #[test]
    fn test_duplicate_pane_id_validation() {
        let dir = temp_test_dir();
        let manager = WorkspaceManager::new(dir);

        let mut ws = sample_workspace();
        ws.panes[1].id = "pane-1".to_string(); // Duplicate ID

        let err = manager.save_workspace(ws).unwrap_err();
        assert!(matches!(err, WorkspaceError::DuplicatePaneId(_)));
    }

    #[test]
    fn test_unreferenced_pane_validation() {
        let dir = temp_test_dir();
        let manager = WorkspaceManager::new(dir);

        let mut ws = sample_workspace();
        ws.panes.push(WorkspacePaneConfig {
            id: "pane-3".to_string(),
            name: "Extra".to_string(),
            cwd: None,
            command: None,
        });

        let err = manager.save_workspace(ws).unwrap_err();
        assert!(matches!(err, WorkspaceError::Validation(_)));
    }

    #[test]
    fn test_empty_workspace_name_validation() {
        let dir = temp_test_dir();
        let manager = WorkspaceManager::new(dir);

        let mut ws = sample_workspace();
        ws.name = "   ".to_string();

        let err = manager.save_workspace(ws).unwrap_err();
        assert!(matches!(err, WorkspaceError::Validation(_)));
    }
}
