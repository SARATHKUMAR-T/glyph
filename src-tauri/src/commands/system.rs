use std::sync::Mutex;
use sysinfo::System;
use tauri::State;

pub struct SystemMonitorState(pub Mutex<System>);

impl Default for SystemMonitorState {
    fn default() -> Self {
        let mut sys = System::new_all();
        sys.refresh_all();
        Self(Mutex::new(sys))
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPerfStats {
    pub cpu_usage: f32,
    pub mem_used_bytes: u64,
    pub mem_total_bytes: u64,
    pub mem_percentage: f32,
    pub cache_bytes: u64,
    pub swap_used_bytes: u64,
    pub swap_total_bytes: u64,
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_system_perf_stats(
    state: State<'_, SystemMonitorState>,
) -> Result<SystemPerfStats, String> {
    let mut sys = state
        .0
        .lock()
        .map_err(|e| format!("Failed to lock system monitor state: {e}"))?;

    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let cpu_usage = sys.global_cpu_usage();
    let mem_total_bytes = sys.total_memory();
    let mem_used_bytes = sys.used_memory();
    let mem_percentage = if mem_total_bytes > 0 {
        (mem_used_bytes as f32 / mem_total_bytes as f32) * 100.0
    } else {
        0.0
    };

    let available = sys.available_memory();
    // Cache is approximate as total - available - used, or free vs available
    let free_bytes = sys.free_memory();
    let cache_bytes = available.saturating_sub(free_bytes);

    let swap_used_bytes = sys.used_swap();
    let swap_total_bytes = sys.total_swap();

    Ok(SystemPerfStats {
        cpu_usage,
        mem_used_bytes,
        mem_total_bytes,
        mem_percentage,
        cache_bytes,
        swap_used_bytes,
        swap_total_bytes,
    })
}
