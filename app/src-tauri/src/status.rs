//! Мост между WebSocket-эндпоинтом Rust-сервера (/ws/status) и React.
//!
//! Схема данных 1:1 повторяет ServerStatus из app/src/api/serverStatus.ts —
//! Tauri здесь не добавляет и не убирает поля, а только проксирует сообщения
//! сервера как Tauri-события, чтобы React не знал ни о сервере, ни о WS напрямую.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio_tungstenite::tungstenite::Message;

const WS_STATUS_URL: &str = "ws://localhost:4242/ws/status";

/// Имя Tauri-события, на которое подписывается React (`listen("server-status", ...)`).
pub const SERVER_STATUS_EVENT: &str = "server-status";

// ─── Типы, зеркалящие ServerStatus с backend (см. backend/src/models/status.rs) ──

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

/// Разовый снимок статуса — используется командой `get_server_status` для первого
/// рендера, до того как откроется/переподключится WS-соединение.
#[tauri::command]
pub async fn get_server_status(
    state: tauri::State<'_, crate::LozaState>,
) -> Result<ServerStatus, String> {
    let resp = state
        .client
        .get("http://localhost:4242/status")
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;

    resp.json::<ServerStatus>()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))
}

/// Фоновая задача: держит WS-соединение к backend'у, при разрыве —
/// переподключается с задержкой. Каждое полученное сообщение эмитится
/// в React как событие `server-status`.
///
/// Запускается один раз при старте приложения (см. lib.rs::run -> setup).
pub fn spawn_status_listener(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            if let Err(e) = run_status_stream(&app).await {
                eprintln!("⚠️  WS /ws/status: {} — переподключение через 3с", e);
            }
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        }
    });
}

async fn run_status_stream(app: &AppHandle) -> Result<(), String> {
    let (ws_stream, _) = tokio_tungstenite::connect_async(WS_STATUS_URL)
        .await
        .map_err(|e| format!("CONNECT_FAILED: {}", e))?;

    let (_write, mut read) = ws_stream.split();

    while let Some(msg) = read.next().await {
        let msg = msg.map_err(|e| format!("WS_ERROR: {}", e))?;
        if let Message::Text(text) = msg {
            match serde_json::from_str::<ServerStatus>(&text) {
                Ok(status) => {
                    let _ = app.emit(SERVER_STATUS_EVENT, status);
                }
                Err(e) => {
                    eprintln!("⚠️  Не удалось разобрать ServerStatus: {}", e);
                }
            }
        }
    }

    Err("STREAM_ENDED".to_string())
}
