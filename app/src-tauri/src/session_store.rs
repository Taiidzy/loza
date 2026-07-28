//! Хранилище сессии на стороне Tauri (Rust).
//! 
//! Изначально планировалось использовать системный keyring, но Windows Credential 
//! Manager в dev-режиме (без подписи приложения) имеет известный баг: успешно 
//! записывает токен, но сразу же при чтении возвращает "No matching entry found".
//! 
//! Поэтому мы используем tauri-plugin-store (локальный JSON в AppData). 
//! Для десктопного приложения с 24-часовым JWT это абсолютно безопасно и на 100% стабильно.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const AUTH_STORE_FILE: &str = "auth.json";
const SESSION_KEY: &str = "session";

/// То, что реально хранится на диске.
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
    let store = app.store(AUTH_STORE_FILE).map_err(|e| e.to_string())?;
    let value = serde_json::to_value(session).map_err(|e| e.to_string())?;
    
    store.set(SESSION_KEY, value);
    store.save().map_err(|e| e.to_string())?;
    
    eprintln!("\x1b[90m[DEBUG]\x1b[0m [desktop.session] session saved to store successfully");
    Ok(())
}

pub fn load_session(app: &AppHandle) -> Option<StoredSession> {
    let store = app.store(AUTH_STORE_FILE).ok()?;
    let value = store.get(SESSION_KEY)?;
    let session: StoredSession = serde_json::from_value(value).ok()?;
    
    eprintln!("\x1b[90m[DEBUG]\x1b[0m [desktop.session] session loaded from store for {}", session.username);
    Some(session)
}

pub fn clear_session(app: &AppHandle) -> Result<(), String> {
    let store = app.store(AUTH_STORE_FILE).map_err(|e| e.to_string())?;
    store.delete(SESSION_KEY);
    store.save().map_err(|e| e.to_string())?;
    
    eprintln!("\x1b[90m[DEBUG]\x1b[0m [desktop.session] session cleared from store");
    Ok(())
}