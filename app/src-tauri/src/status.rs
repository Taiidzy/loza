//! Мост между HTTP-эндпоинтом сервера (/status) и React.
//!
//! `get_server_status` — разовый HTTP-снимок для первого рендера, до того
//! как откроется WS-соединение (см. ws_client.rs). После этого статус
//! приходит через WS-стрим `/ws/app` в виде push-сообщений.
//!
//! Типы зеркали `ServerStatus` с backend'а (см. backend/src/models/status.rs).

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::server_config;
use crate::session_store;

// ─── Типы, зеркалящие ServerStatus с backend ────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ActivityEvent {
    pub time: String,
    pub msg: String,
    #[serde(rename = "type")]
    pub kind: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ClientInfo {
    pub id: String,
    pub name: String,
    pub device: String,
    pub active: bool,
    #[serde(rename = "lastSeen")]
    pub last_seen: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StorageCategory {
    pub id: String,
    pub label: String,
    pub bytes: u64,
    pub color: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StorageInfo {
    #[serde(rename = "totalBytes")]
    pub total_bytes: u64,
    #[serde(rename = "usedBytes")]
    pub used_bytes: u64,
    pub categories: Vec<StorageCategory>,
    pub history7d: Vec<f32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LoadInfo {
    #[serde(rename = "cpuPercent")]
    pub cpu_percent: f32,
    #[serde(rename = "memPercent")]
    pub mem_percent: f32,
    pub history: Vec<f32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServerStatus {
    pub clients: Vec<ClientInfo>,
    pub storage: StorageInfo,
    pub load: LoadInfo,
    pub activity: Vec<ActivityEvent>,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

/// Разовый снимок статуса — используется для первого рендера, до того
/// как откроется WS-соединение (ws_client.rs).
#[tauri::command]
pub async fn get_server_status(
    app: AppHandle,
    state: tauri::State<'_, crate::LozaState>,
) -> Result<ServerStatus, String> {
    let server_url = server_config::require_server_url(&app)?;
    let session =
        session_store::load_session(&app).ok_or_else(|| "NO_SESSION".to_string())?;

    let resp = state
        .client
        .get(format!("{}/status", server_url))
        .header("x-session-token", session.token)
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;

    resp.json::<ServerStatus>()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))
}
