//! Прокси между React и backend'ом для файлового хранилища.
//!
//! Вся работа с файлами (list, info, upload, download, view, delete, rename,
//! move, copy, mkdir) идёт через HTTP к /files/* endpoint'ам backend'а.
//! WebSocket не используется для файловых операций — только для push-событий.
//!
//! React видит только типизированные ответы (FileInfo, Vec<FileInfo>, bytes),
//! а токен сессии и адрес сервера подставляются автоматически из Rust-хранилища.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::server_config;
use crate::session_store;
use crate::LozaState;

// ─── Types (mirror backend/src/models/file.rs) ─────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileInfo {
    pub id: String,
    pub path: String,
    pub name: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: u64,
    #[serde(rename = "mimeType")]
    pub mime_type: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct CreateDirRequest {
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MoveRequest {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CopyRequest {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Deserialize)]
struct ServerErrorResponse {
    error: String,
    code: String,
}

fn describe_error(body: Option<ServerErrorResponse>, fallback: &str) -> String {
    match body {
        Some(e) => format!("{}: {}", e.code, e.error),
        None => fallback.to_string(),
    }
}

fn require_session(app: &AppHandle) -> Result<(String, String), String> {
    let token = session_store::load_session(app)
        .map(|s| s.token)
        .ok_or_else(|| "NO_SESSION: Not logged in".to_string())?;
    let server_url = server_config::require_server_url(app)?;
    Ok((token, server_url))
}

// ─── Tauri invoke commands ─────────────────────────────────────────────────────

/// `invoke("list_files", { path })`
#[tauri::command]
pub async fn list_files(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    path: String,
) -> Result<Vec<FileInfo>, String> {
    let (token, server_url) = require_session(&app)?;

    let mut url = url::Url::parse(&format!("{}/files/list", server_url))
        .map_err(|e| format!("URL_ERROR: {}", e))?;
    url.query_pairs_mut().append_pair("path", &path);

    let resp = state
        .client
        .get(url.as_str())
        .header("x-session-token", token)
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;

    if !resp.status().is_success() {
        let err = resp.json::<ServerErrorResponse>().await.ok();
        return Err(describe_error(err, "UNKNOWN: Failed to list files"));
    }

    resp.json::<Vec<FileInfo>>()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))
}

/// `invoke("get_file_info", { path })`
#[tauri::command]
pub async fn get_file_info(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    path: String,
) -> Result<FileInfo, String> {
    let (token, server_url) = require_session(&app)?;

    let mut url = url::Url::parse(&format!("{}/files/info", server_url))
        .map_err(|e| format!("URL_ERROR: {}", e))?;
    url.query_pairs_mut().append_pair("path", &path);

    let resp = state
        .client
        .get(url.as_str())
        .header("x-session-token", token)
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;

    if !resp.status().is_success() {
        let err = resp.json::<ServerErrorResponse>().await.ok();
        return Err(describe_error(err, "UNKNOWN: Failed to get file info"));
    }

    resp.json::<FileInfo>()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))
}

/// `invoke("upload_file", { path, filename, data })`
/// `data` is a `Vec<u8>` containing the file content.
#[tauri::command]
pub async fn upload_file(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    path: String,
    filename: String,
    data: Vec<u8>,
) -> Result<FileInfo, String> {
    let (token, server_url) = require_session(&app)?;

    let form = reqwest::multipart::Form::new()
        .text("path", path)
        .part(
            "file",
            reqwest::multipart::Part::bytes(data)
                .file_name(filename.clone()),
        );

    let resp = state
        .client
        .post(format!("{}/files/upload", server_url))
        .header("x-session-token", token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;

    if !resp.status().is_success() {
        let err = resp.json::<ServerErrorResponse>().await.ok();
        return Err(describe_error(err, "UNKNOWN: Failed to upload file"));
    }

    resp.json::<FileInfo>()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))
}

/// `invoke("download_file", { path })`
/// Returns the raw bytes of the file.
#[tauri::command]
pub async fn download_file(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    path: String,
) -> Result<Vec<u8>, String> {
    let (token, server_url) = require_session(&app)?;

    let mut url = url::Url::parse(&format!("{}/files/download", server_url))
        .map_err(|e| format!("URL_ERROR: {}", e))?;
    url.query_pairs_mut().append_pair("path", &path);

    let resp = state
        .client
        .get(url.as_str())
        .header("x-session-token", token)
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;

    if !resp.status().is_success() {
        let err = resp.json::<ServerErrorResponse>().await.ok();
        return Err(describe_error(err, "UNKNOWN: Failed to download file"));
    }

    resp.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("READ_ERROR: {}", e))
}

/// `invoke("delete_file", { path })`
#[tauri::command]
pub async fn delete_file(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    path: String,
) -> Result<(), String> {
    let (token, server_url) = require_session(&app)?;

    let mut url = url::Url::parse(&format!("{}/files/delete", server_url))
        .map_err(|e| format!("URL_ERROR: {}", e))?;
    url.query_pairs_mut().append_pair("path", &path);

    let resp = state
        .client
        .delete(url.as_str())
        .header("x-session-token", token)
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;

    if !resp.status().is_success() {
        let err = resp.json::<ServerErrorResponse>().await.ok();
        return Err(describe_error(err, "UNKNOWN: Failed to delete file"));
    }

    Ok(())
}

/// `invoke("rename_file", { from, to })`
#[tauri::command]
pub async fn rename_file(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    req: MoveRequest,
) -> Result<FileInfo, String> {
    let (token, server_url) = require_session(&app)?;

    let resp = state
        .client
        .post(format!("{}/files/rename", server_url))
        .header("x-session-token", token)
        .json(&req)
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;

    if !resp.status().is_success() {
        let err = resp.json::<ServerErrorResponse>().await.ok();
        return Err(describe_error(err, "UNKNOWN: Failed to rename file"));
    }

    resp.json::<FileInfo>()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))
}

/// `invoke("move_file", { from, to })`
#[tauri::command]
pub async fn move_file(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    req: MoveRequest,
) -> Result<FileInfo, String> {
    let (token, server_url) = require_session(&app)?;

    let resp = state
        .client
        .post(format!("{}/files/move", server_url))
        .header("x-session-token", token)
        .json(&req)
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;

    if !resp.status().is_success() {
        let err = resp.json::<ServerErrorResponse>().await.ok();
        return Err(describe_error(err, "UNKNOWN: Failed to move file"));
    }

    resp.json::<FileInfo>()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))
}

/// `invoke("copy_file", { from, to })`
#[tauri::command]
pub async fn copy_file(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    req: CopyRequest,
) -> Result<FileInfo, String> {
    let (token, server_url) = require_session(&app)?;

    let resp = state
        .client
        .post(format!("{}/files/copy", server_url))
        .header("x-session-token", token)
        .json(&req)
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;

    if !resp.status().is_success() {
        let err = resp.json::<ServerErrorResponse>().await.ok();
        return Err(describe_error(err, "UNKNOWN: Failed to copy file"));
    }

    resp.json::<FileInfo>()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))
}

/// `invoke("create_dir", { path })`
#[tauri::command]
pub async fn create_dir(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    path: String,
) -> Result<FileInfo, String> {
    let (token, server_url) = require_session(&app)?;

    let resp = state
        .client
        .post(format!("{}/files/mkdir", server_url))
        .header("x-session-token", token)
        .json(&serde_json::json!({ "path": path }))
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;

    if !resp.status().is_success() {
        let err = resp.json::<ServerErrorResponse>().await.ok();
        return Err(describe_error(err, "UNKNOWN: Failed to create directory"));
    }

    resp.json::<FileInfo>()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))
}
