use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::server_config;
use crate::session_store;
use crate::LozaState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PublicUser {
    pub username: String,
    pub display_name: String,
    pub role: String,
    pub quota_bytes: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    pub password: String,
    pub display_name: Option<String>,
    pub role: Option<String>,
    pub quota_bytes: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: Option<String>,
    pub new_password: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateQuotaRequest {
    pub quota_bytes: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct ServerErrorResponse {
    error: String,
    code: String,
}

async fn decode_error(resp: reqwest::Response, fallback: &str) -> String {
    let status = resp.status();
    let raw = resp.text().await.unwrap_or_default();
    if let Ok(err) = serde_json::from_str::<ServerErrorResponse>(&raw) {
        format!("{}: {}", err.code, err.error)
    } else {
        format!("{} (HTTP {})", fallback, status)
    }
}

fn auth_context(app: &AppHandle) -> Result<(String, String), String> {
    let server_url = server_config::require_server_url(app)?;
    let session = session_store::load_session(app).ok_or_else(|| "NO_SESSION".to_string())?;
    Ok((server_url, session.token))
}

#[tauri::command]
pub async fn list_users(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
) -> Result<Vec<PublicUser>, String> {
    let (server_url, token) = auth_context(&app)?;
    let resp = state
        .client
        .get(format!("{}/users", server_url))
        .header("x-session-token", token)
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;

    if !resp.status().is_success() {
        return Err(decode_error(resp, "LIST_USERS_FAILED").await);
    }

    resp.json::<Vec<PublicUser>>()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))
}

#[tauri::command]
pub async fn create_user(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    request: CreateUserRequest,
) -> Result<PublicUser, String> {
    let (server_url, token) = auth_context(&app)?;
    let resp = state
        .client
        .post(format!("{}/users", server_url))
        .header("x-session-token", token)
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;

    if !resp.status().is_success() {
        return Err(decode_error(resp, "CREATE_USER_FAILED").await);
    }

    resp.json::<PublicUser>()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))
}

#[tauri::command]
pub async fn change_user_password(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    username: String,
    request: ChangePasswordRequest,
) -> Result<(), String> {
    let (server_url, token) = auth_context(&app)?;
    let resp = state
        .client
        .put(format!("{}/users/{}/password", server_url, username))
        .header("x-session-token", token)
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;

    if !resp.status().is_success() {
        return Err(decode_error(resp, "CHANGE_PASSWORD_FAILED").await);
    }

    Ok(())
}

#[tauri::command]
pub async fn update_user_quota(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    username: String,
    request: UpdateQuotaRequest,
) -> Result<PublicUser, String> {
    let (server_url, token) = auth_context(&app)?;
    let resp = state
        .client
        .put(format!("{}/users/{}/quota", server_url, username))
        .header("x-session-token", token)
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;

    if !resp.status().is_success() {
        return Err(decode_error(resp, "UPDATE_QUOTA_FAILED").await);
    }

    resp.json::<PublicUser>()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))
}

#[tauri::command]
pub async fn delete_user(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    username: String,
) -> Result<(), String> {
    let (server_url, token) = auth_context(&app)?;
    let resp = state
        .client
        .delete(format!("{}/users/{}", server_url, username))
        .header("x-session-token", token)
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;

    if !resp.status().is_success() {
        return Err(decode_error(resp, "DELETE_USER_FAILED").await);
    }

    Ok(())
}
