//! Прокси между React и backend'ом для файлового хранилища.
//!
//! Вся работа с файлами (list, info, upload, download, view, delete, rename,
//! move, copy, mkdir) идёт через HTTP к /files/* endpoint'ам backend'а.
//! WebSocket не используется для файловых операций — только для push-событий.
//!
//! React видит только типизированные ответы (FileInfo, Vec<FileInfo>, bytes),
//! а токен сессии и адрес сервера подставляются автоматически из Rust-хранилища.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

use crate::server_config;
use crate::session_store;
use crate::LozaState;
use crate::ws_client::FILE_PROGRESS_EVENT_PREFIX;

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

/// Reads a non-success HTTP response body and produces a descriptive error.
/// Tries to parse as `ServerErrorResponse`; if that fails, includes the
/// HTTP status code and raw body text so diagnostics are never lost.
async fn describe_http_error(resp: reqwest::Response, operation: &str) -> String {
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    match serde_json::from_str::<ServerErrorResponse>(&body) {
        Ok(e) => format!("{}: {}", e.code, e.error),
        Err(_) => {
            let reason = status.canonical_reason().unwrap_or("Unknown");
            format!("HTTP {} {} ({}) — body: {}", status.as_u16(), reason, operation, body)
        }
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
        return Err(describe_http_error(resp, "list files").await);
    }

    resp.json::<Vec<FileInfo>>()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))
}

/// `invoke("search_files", { query, path })`
/// Searches recursively within `path` (or root if empty) for files matching the query.
#[tauri::command]
pub async fn search_files(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    query: String,
    path: String,
) -> Result<Vec<FileInfo>, String> {
    let (token, server_url) = require_session(&app)?;

    let mut url = url::Url::parse(&format!("{}/files/search", server_url))
        .map_err(|e| format!("URL_ERROR: {}", e))?;
    url.query_pairs_mut()
        .append_pair("q", &query)
        .append_pair("path", &path);

    let resp = state
        .client
        .get(url.as_str())
        .header("x-session-token", token)
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;

    if !resp.status().is_success() {
        return Err(describe_http_error(resp, "search files").await);
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
        return Err(describe_http_error(resp, "get file info").await);
    }

    resp.json::<FileInfo>()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))
}


/// `invoke("upload_file", { path, filename, data, overwrite?, progressId? })`
/// `data` is a `Vec<u8>` containing the file content.
/// `progressId` (optional) - UUID from the frontend to correlate progress events.
/// `overwrite` (optional) - if true, replaces existing file.
///
/// Emits progress events on `file-progress-{progressId}` with `{ sent, total }`.
#[tauri::command]
pub async fn upload_file(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    path: String,
    filename: String,
    data: Vec<u8>,
    overwrite: Option<bool>,
    progress_id: Option<String>,
) -> Result<FileInfo, String> {
    let (token, server_url) = require_session(&app)?;

    let total = data.len() as u64;
    let progress_id = progress_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let progress_event = format!("{}{}", FILE_PROGRESS_EVENT_PREFIX, progress_id);

    let chunk_size = 512 * 1024usize;

    // Use a duplex channel: a background task writes chunks and emits progress,
    // while the receiver is wrapped in a stream for reqwest's Part::stream.
    let (mut writer, reader) = tokio::io::duplex(data.len().min(64 * 1024 * 1024) + 1);

    let sent_counter = Arc::new(AtomicU64::new(0));
    let app_for_task = app.clone();
    let progress_event_for_task = progress_event.clone();
    let total_for_task = total;

    let progress_handle = tokio::spawn(async move {
        for chunk in data.chunks(chunk_size) {
            let new_sent = sent_counter.fetch_add(chunk.len() as u64, Ordering::SeqCst) + chunk.len() as u64;
            let _ = app_for_task.emit(
                &progress_event_for_task,
                serde_json::json!({ "sent": new_sent, "total": total_for_task }),
            );
            tracing::debug!("[upload] progress {}/{}", new_sent, total_for_task);
            if let Err(e) = writer.write_all(chunk).await {
                tracing::error!("[upload] write error: {}", e);
                return;
            }
        }

        // Emit final progress event
        let _ = app_for_task.emit(
            &progress_event_for_task,
            serde_json::json!({ "sent": total_for_task, "total": total_for_task }),
        );

        let _ = writer.shutdown().await;
    });

    // Convert the DuplexStream reader into a streaming Body with progress
    let reader_stream = tokio_util::io::ReaderStream::new(reader);
    let body = reqwest::Body::wrap_stream(reader_stream);

    let form = reqwest::multipart::Form::new()
        .text("path", path)
        .text("overwrite", overwrite.unwrap_or(false).to_string())
        .text("progressId", progress_id)
        .part(
            "file",
            reqwest::multipart::Part::stream(body)
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

    // Ensure the progress task has completed
    progress_handle.abort();

    if !resp.status().is_success() {
        return Err(describe_http_error(resp, "upload file").await);
    }

    resp.json::<FileInfo>()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))
}

/// `invoke("download_file", { path, progressId? })`
/// Returns the raw bytes of the file as a `Vec<u8>`.
///
/// Emits progress events on `file-progress-{progressId}` with `{ received, total }`.
#[tauri::command]
pub async fn download_file(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    path: String,
    progress_id: Option<String>,
) -> Result<Vec<u8>, String> {
    let (token, server_url) = require_session(&app)?;

    let progress_id = progress_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let progress_event = format!("{}{}", FILE_PROGRESS_EVENT_PREFIX, progress_id);

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
        return Err(describe_http_error(resp, "download file").await);
    }

    let total = resp.content_length().unwrap_or(0);
    let app_for_stream = app.clone();
    let progress_event_for_stream = progress_event.clone();

    let mut body = resp;

    let mut result = Vec::new();
    let mut received: u64 = 0;

    loop {
        match body.chunk().await {
            Ok(Some(chunk)) => {
                received += chunk.len() as u64;
                if total > 0 {
                    let _ = app_for_stream.emit(
                        &progress_event_for_stream,
                        serde_json::json!({ "received": received, "total": total }),
                    );
                }
                result.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(e) => return Err(format!("READ_ERROR: {}", e)),
        }
    }

    // Emit final progress event
    let _ = app.emit(
        &progress_event,
        serde_json::json!({ "received": total, "total": total }),
    );

    Ok(result)
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
        return Err(describe_http_error(resp, "delete file").await);
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
        return Err(describe_http_error(resp, "rename file").await);
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
        return Err(describe_http_error(resp, "move file").await);
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
        return Err(describe_http_error(resp, "copy file").await);
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
        return Err(describe_http_error(resp, "create directory").await);
    }

    resp.json::<FileInfo>()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))
}
