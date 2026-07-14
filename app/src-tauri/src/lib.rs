use serde::{Deserialize, Serialize};
use tauri::Manager;
use window_vibrancy::{apply_mica, apply_vibrancy, NSVisualEffectMaterial};

// ─── Server base URL ──────────────────────────────────────────────────────────
const SERVER_URL: &str = "http://127.0.0.1:4242";

// ─── Shared HTTP client state ─────────────────────────────────────────────────

pub struct LozaState {
    pub client: reqwest::Client,
}

// ─── Types mirroring server responses ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LoginResponse {
    pub token: String,
    pub username: String,
    pub display_name: String,
    pub role: String,
    pub expires_at: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserInfo {
    pub username: String,
    pub display_name: String,
    pub role: String,
    pub session_created_at: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ErrorResponse {
    pub error: String,
    pub code: String,
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/// Called by React via `invoke("login", { username, password })`
/// Proxies the request to the standalone Rust server.
#[tauri::command]
async fn login(
    state: tauri::State<'_, LozaState>,
    username: String,
    password: String,
) -> Result<LoginResponse, String> {
    let body = serde_json::json!({
        "username": username,
        "password": password,
    });

    let resp = state
        .client
        .post(format!("{}/auth/login", SERVER_URL))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;

    if resp.status().is_success() {
        resp.json::<LoginResponse>()
            .await
            .map_err(|e| format!("PARSE_ERROR: {}", e))
    } else {
        let err = resp
            .json::<ErrorResponse>()
            .await
            .unwrap_or(ErrorResponse {
                error: "Unknown error".to_string(),
                code: "UNKNOWN".to_string(),
            });
        Err(format!("{}: {}", err.code, err.error))
    }
}

/// Called by React via `invoke("get_me", { token })`
#[tauri::command]
async fn get_me(
    state: tauri::State<'_, LozaState>,
    token: String,
) -> Result<UserInfo, String> {
    let resp = state
        .client
        .get(format!("{}/auth/me", SERVER_URL))
        .header("x-session-token", &token)
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;

    if resp.status().is_success() {
        resp.json::<UserInfo>()
            .await
            .map_err(|e| format!("PARSE_ERROR: {}", e))
    } else {
        let err = resp
            .json::<ErrorResponse>()
            .await
            .unwrap_or(ErrorResponse {
                error: "Unknown error".to_string(),
                code: "UNKNOWN".to_string(),
            });
        Err(format!("{}: {}", err.code, err.error))
    }
}

/// Called by React via `invoke("logout", { token })`
#[tauri::command]
async fn logout(
    state: tauri::State<'_, LozaState>,
    token: String,
) -> Result<(), String> {
    let _ = state
        .client
        .post(format!("{}/auth/logout", SERVER_URL))
        .header("x-session-token", &token)
        .send()
        .await;
    Ok(())
}

/// Health check — used on startup to verify the server is running
#[tauri::command]
async fn health_check(state: tauri::State<'_, LozaState>) -> Result<bool, String> {
    let resp = state
        .client
        .get(format!("{}/health", SERVER_URL))
        .send()
        .await;
    Ok(resp.map(|r| r.status().is_success()).unwrap_or(false))
}

// ─── Entry point ──────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();

            #[cfg(target_os = "macos")]
            let _ = apply_vibrancy(
                &window,
                NSVisualEffectMaterial::Popover,
                None,
                Some(14.0),
            );

            #[cfg(target_os = "windows")]
            let _ = apply_mica(&window, Some(true));

            Ok(())
        })
        .manage(LozaState {
            client: reqwest::Client::new(),
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            login,
            get_me,
            logout,
            health_check
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}