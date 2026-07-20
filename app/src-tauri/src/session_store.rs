//! Хранилище сессии на стороне Tauri (Rust). React никогда не видит токен —
//! он живёт только здесь, персистентно на диске (tauri-plugin-store, JSON-файл
//! в app data dir), и подставляется в запросы к backend'у самим Rust-слоем.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "session.json";
const SESSION_KEY: &str = "session";

/// То, что реально хранится на диске — совпадает по полям с LoginResponse
/// backend'а (см. backend/src/handlers/auth.rs), плюс device, который
/// понадобится при следующем refresh/login.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StoredSession {
    pub token: String,
    pub username: String,
    pub display_name: String,
    pub role: String,
    pub device: String,
    pub expires_at: u64,
}

pub fn save_session(app: &AppHandle, session: &StoredSession) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let value = serde_json::to_value(session).map_err(|e| e.to_string())?;
    store.set(SESSION_KEY, value);
    store.save().map_err(|e| e.to_string())
}

pub fn load_session(app: &AppHandle) -> Option<StoredSession> {
    let store = app.store(STORE_FILE).ok()?;
    let value = store.get(SESSION_KEY)?;
    serde_json::from_value(value).ok()
}

pub fn clear_session(app: &AppHandle) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.delete(SESSION_KEY);
    store.save().map_err(|e| e.to_string())
}
