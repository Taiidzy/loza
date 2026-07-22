//! Мост между WebSocket-эндпоинтом Rust-сервера (/ws/status) и React.
//!
//! Схема данных 1:1 повторяет ServerStatus из app/src/api/serverStatus.ts —
//! Tauri здесь не добавляет и не убирает поля, а только проксирует сообщения
//! сервера как Tauri-события, чтобы React не знал ни о сервере, ни о WS напрямую.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio_tungstenite::tungstenite::Message;

use crate::server_config;

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
    app: AppHandle,
    state: tauri::State<'_, crate::LozaState>,
) -> Result<ServerStatus, String> {
    let server_url = server_config::require_server_url(&app)?;

    let resp = state
        .client
        .get(format!("{}/status", server_url))
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
/// Запускается один раз при старте приложения (см. lib.rs::run -> setup),
/// то есть возможно до того, как пользователь вообще настроил адрес сервера
/// (первый запуск). В этом случае просто тихо ждёт и пробует снова —
/// как только ServerSetupPage сохранит адрес через `set_server_url`,
/// следующая попытка его подхватит без перезапуска приложения. Так же
/// подхватывается и смена адреса через "Сменить сервер" в настройках.
pub fn spawn_status_listener(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            match server_config::load_server_url(&app) {
                None => {
                    // Сервер ещё не настроен — не спамим лог, просто ждём.
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    continue;
                }
                Some(server_url) => {
                    if let Err(e) = run_status_stream(&app, &server_url).await {
                        eprintln!("⚠️  WS /ws/status: {} — переподключение через 3с", e);
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                }
            }
        }
    });
}

async fn run_status_stream(app: &AppHandle, server_url: &str) -> Result<(), String> {
    let ws_url = server_config::require_ws_url_from(server_url, "/ws/status")?;
    let ws_url_for_error = ws_url.clone();

    let (ws_stream, _) = tokio_tungstenite::connect_async(ws_url)
        .await
        .map_err(|e| format!("CONNECT_FAILED: {}, url -- {}", e, ws_url_for_error))?;

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
