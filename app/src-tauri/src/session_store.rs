//! Хранилище сессии на стороне Tauri (Rust). React никогда не видит токен —
//! он хранится в системном credential storage (Keychain/Credential Manager/
//! Secret Service), а не в читаемом JSON-файле app data dir.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const KEYRING_SERVICE: &str = "com.taiidzy.loza";
const KEYRING_ACCOUNT: &str = "session";
const LEGACY_STORE_FILE: &str = "session.json";
const LEGACY_SESSION_KEY: &str = "session";

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
    let serialized = serde_json::to_string(session).map_err(|e| e.to_string())?;
    credential()?
        .set_password(&serialized)
        .map_err(|e| format!("failed to save session in system credential storage: {e}"))?;
    clear_legacy_session(app);
    Ok(())
}

pub fn load_session(app: &AppHandle) -> Option<StoredSession> {
    let session = credential()
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .and_then(|serialized| serde_json::from_str(&serialized).ok());
    if session.is_none() {
        // Не переносим токен из legacy JSON: это сохранило бы небезопасное
        // хранилище. Пользователь войдёт заново и сессия попадёт в keychain.
        clear_legacy_session(app);
    }
    session
}

pub fn clear_session(app: &AppHandle) -> Result<(), String> {
    clear_legacy_session(app);
    match credential()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "failed to remove session from system credential storage: {error}"
        )),
    }
}

fn credential() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|e| e.to_string())
}

fn clear_legacy_session(app: &AppHandle) {
    if let Ok(store) = app.store(LEGACY_STORE_FILE) {
        store.delete(LEGACY_SESSION_KEY);
        let _ = store.save();
    }
}
