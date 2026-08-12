use serde::Serialize;

pub const OUTPUT_EVENT: &str = "terminal://output";
pub const EXIT_EVENT: &str = "terminal://exit";
pub const ERROR_EVENT: &str = "terminal://error";
pub const STATE_EVENT: &str = "terminal://state";
pub const SEMANTIC_EVENT: &str = "terminal://semantic";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutputEvent {
    pub session_id: String,
    pub data: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExitEvent {
    pub session_id: String,
    pub exit_code: Option<u32>,
    pub signal: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalErrorEvent {
    pub session_id: Option<String>,
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStateEvent {
    pub session_id: String,
    pub state: String,
    pub timestamp: u128,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSemanticEvent {
    pub session_id: String,
    pub kind: String,
    pub exit_code: Option<i32>,
    pub raw: String,
    pub timestamp: u128,
}
