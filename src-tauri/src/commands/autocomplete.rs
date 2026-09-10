use std::collections::HashSet;
use std::env;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use serde::{Deserialize, Serialize};

static PATH_CACHE: Mutex<Option<Vec<String>>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsCompletionEntry {
    pub name: String,
    pub is_dir: bool,
    pub is_executable: bool,
    pub full_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCompletionData {
    pub is_repo: bool,
    pub current_branch: Option<String>,
    pub branches: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCompletionData {
    pub npm_scripts: Vec<String>,
    pub cargo_targets: Vec<String>,
    pub make_targets: Vec<String>,
}

/// Scans all directories in $PATH and returns a deduplicated list of executable binary names.
/// Results are cached in memory for sub-millisecond retrieval.
#[tauri::command(rename_all = "camelCase")]
pub fn get_path_executables(force_refresh: Option<bool>) -> Result<Vec<String>, String> {
    let refresh = force_refresh.unwrap_or(false);
    let mut cache = PATH_CACHE.lock().map_err(|e| e.to_string())?;

    if !refresh {
        if let Some(ref cached) = *cache {
            return Ok(cached.clone());
        }
    }

    let path_var = env::var("PATH").unwrap_or_default();
    let mut seen = HashSet::new();
    let mut executables = Vec::new();

    for dir_str in env::split_paths(&path_var) {
        if let Ok(entries) = fs::read_dir(&dir_str) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type() {
                    if file_type.is_file() || file_type.is_symlink() {
                        if let Ok(metadata) = entry.metadata() {
                            let permissions = metadata.permissions();
                            // Check if executable by user, group, or others
                            if permissions.mode() & 0o111 != 0 {
                                if let Ok(name) = entry.file_name().into_string() {
                                    if !name.is_empty() && !name.starts_with('.') && seen.insert(name.clone()) {
                                        executables.push(name);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    executables.sort();
    *cache = Some(executables.clone());
    Ok(executables)
}

/// Lists filesystem entries in a directory given a CWD and path prefix.
#[tauri::command(rename_all = "camelCase")]
pub fn get_fs_completions(cwd: String, path_prefix: String) -> Result<Vec<FsCompletionEntry>, String> {
    let home_dir = env::var("HOME").unwrap_or_else(|_| "/root".to_string());
    
    // Resolve base path and search directory
    let expanded = if path_prefix.starts_with("~/") || path_prefix == "~" {
        path_prefix.replacen('~', &home_dir, 1)
    } else {
        path_prefix.clone()
    };

    let target_path = if Path::new(&expanded).is_absolute() {
        PathBuf::from(&expanded)
    } else {
        PathBuf::from(&cwd).join(&expanded)
    };

    let (search_dir, file_prefix) = if expanded.ends_with('/') {
        (target_path, String::new())
    } else if let Some(parent) = target_path.parent() {
        let prefix = target_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        (parent.to_path_buf(), prefix)
    } else {
        (PathBuf::from(&cwd), String::new())
    };

    let mut entries = Vec::new();

    if let Ok(read_dir) = fs::read_dir(&search_dir) {
        for entry in read_dir.flatten() {
            if let Ok(name) = entry.file_name().into_string() {
                // If the user hasn't typed a leading dot, hide hidden files
                if !file_prefix.starts_with('.') && name.starts_with('.') {
                    continue;
                }

                if name.to_lowercase().starts_with(&file_prefix.to_lowercase()) {
                    let mut is_dir = false;
                    let mut is_executable = false;

                    if let Ok(metadata) = entry.metadata() {
                        is_dir = metadata.is_dir();
                        is_executable = !is_dir && (metadata.permissions().mode() & 0o111 != 0);
                    }

                    let full_path = entry.path().to_string_lossy().to_string();

                    entries.push(FsCompletionEntry {
                        name: if is_dir { format!("{name}/") } else { name },
                        is_dir,
                        is_executable,
                        full_path,
                    });
                }
            }
        }
    }

    entries.sort_by(|a, b| {
        // Directories first, then alphabetical
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}

/// Reads local Git metadata and branch names for the CWD.
#[tauri::command(rename_all = "camelCase")]
pub fn get_git_completions(cwd: String) -> Result<GitCompletionData, String> {
    let mut current_dir = PathBuf::from(&cwd);
    let mut git_dir = None;

    // Walk up to find .git
    loop {
        let candidate = current_dir.join(".git");
        if candidate.exists() {
            git_dir = Some(candidate);
            break;
        }
        if !current_dir.pop() {
            break;
        }
    }

    let git_dir = match git_dir {
        Some(d) => d,
        None => {
            return Ok(GitCompletionData {
                is_repo: false,
                current_branch: None,
                branches: Vec::new(),
            })
        }
    };

    let mut branches = HashSet::new();
    let mut current_branch = None;

    // 1. Read HEAD to get current branch
    let head_path = git_dir.join("HEAD");
    if let Ok(head_content) = fs::read_to_string(&head_path) {
        let trimmed = head_content.trim();
        if let Some(branch_ref) = trimmed.strip_prefix("ref: refs/heads/") {
            let b = branch_ref.to_string();
            current_branch = Some(b.clone());
            branches.insert(b);
        }
    }

    // 2. Read local branch heads from .git/refs/heads
    let heads_dir = git_dir.join("refs").join("heads");
    fn read_heads_recursive(dir: &Path, prefix: &str, branches: &mut HashSet<String>) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type() {
                    let file_name = entry.file_name().to_string_lossy().to_string();
                    if file_type.is_dir() {
                        let next_prefix = if prefix.is_empty() {
                            file_name
                        } else {
                            format!("{prefix}/{file_name}")
                        };
                        read_heads_recursive(&entry.path(), &next_prefix, branches);
                    } else if file_type.is_file() {
                        let branch_name = if prefix.is_empty() {
                            file_name
                        } else {
                            format!("{prefix}/{file_name}")
                        };
                        branches.insert(branch_name);
                    }
                }
            }
        }
    }

    read_heads_recursive(&heads_dir, "", &mut branches);

    // 3. Read packed-refs if exists
    let packed_refs = git_dir.join("packed-refs");
    if let Ok(packed_content) = fs::read_to_string(&packed_refs) {
        for line in packed_content.lines() {
            let line = line.trim();
            if line.starts_with('#') || line.starts_with('^') {
                continue;
            }
            if let Some((_, ref_path)) = line.split_once(' ') {
                if let Some(branch) = ref_path.strip_prefix("refs/heads/") {
                    branches.insert(branch.to_string());
                }
            }
        }
    }

    let mut branch_list: Vec<String> = branches.into_iter().collect();
    branch_list.sort();

    Ok(GitCompletionData {
        is_repo: true,
        current_branch,
        branches: branch_list,
    })
}

/// Reads package.json scripts, Cargo.toml, and Makefile targets in CWD.
#[tauri::command(rename_all = "camelCase")]
pub fn get_project_completions(cwd: String) -> Result<ProjectCompletionData, String> {
    let dir = PathBuf::from(&cwd);
    let mut npm_scripts = Vec::new();
    let mut cargo_targets = Vec::new();
    let mut make_targets = Vec::new();

    // 1. package.json
    let pkg_path = dir.join("package.json");
    if let Ok(content) = fs::read_to_string(&pkg_path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(scripts) = json.get("scripts").and_then(|s| s.as_object()) {
                for key in scripts.keys() {
                    npm_scripts.push(key.clone());
                }
            }
        }
    }

    // 2. Cargo.toml
    let cargo_path = dir.join("Cargo.toml");
    if cargo_path.exists() {
        cargo_targets.push("build".to_string());
        cargo_targets.push("run".to_string());
        cargo_targets.push("test".to_string());
        cargo_targets.push("check".to_string());
        cargo_targets.push("clippy".to_string());
        cargo_targets.push("fmt".to_string());
        cargo_targets.push("doc".to_string());
        cargo_targets.push("bench".to_string());
        cargo_targets.push("clean".to_string());
    }

    // 3. Makefile
    let makefile_path = dir.join("Makefile");
    if let Ok(content) = fs::read_to_string(&makefile_path) {
        for line in content.lines() {
            // Makefile target starts at column 0 and ends with colon: "target: ..."
            if let Some(target) = line.split(':').next() {
                let trimmed = target.trim();
                if !trimmed.starts_with('.') && !trimmed.starts_with('#') && !trimmed.contains('=') && !trimmed.is_empty() {
                    if !make_targets.contains(&trimmed.to_string()) {
                        make_targets.push(trimmed.to_string());
                    }
                }
            }
        }
    }

    npm_scripts.sort();
    cargo_targets.sort();
    make_targets.sort();

    Ok(ProjectCompletionData {
        npm_scripts,
        cargo_targets,
        make_targets,
    })
}
