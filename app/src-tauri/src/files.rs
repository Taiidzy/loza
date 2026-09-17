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
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BatchOperation {
    Copy,
    Move,
    Delete,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchRequest {
    pub operation: BatchOperation,
    pub paths: Vec<String>,
    pub destination: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchItemResult {
    pub path: String,
    pub target_path: Option<String>,
    pub success: bool,
    pub error: Option<String>,
    pub file: Option<FileInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchResponse {
    pub operation: String,
    pub results: Vec<BatchItemResult>,
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

    let resp = match state
        .client
        .post(format!("{}/files/upload", server_url))
        .header("x-session-token", token)
        .multipart(form)
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(e) => {
            progress_handle.abort();
            return Err(format!("SERVER_UNREACHABLE: {}", e));
        }
    };

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
/// This loads the whole file into memory — it is meant for previews only.
/// Rejects files beyond `DOWNLOAD_IN_MEMORY_LIMIT` to avoid exhausting the
/// process; large files should use `download_file_to_downloads` instead.
///
/// Emits progress events on `file-progress-{progressId}` with `{ received, total }`.
const DOWNLOAD_IN_MEMORY_LIMIT: u64 = 100 * 1024 * 1024;

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
    if total > DOWNLOAD_IN_MEMORY_LIMIT {
        return Err(format!(
            "FILE_TOO_LARGE: files larger than {} MB must be downloaded via download_file_to_downloads",
            DOWNLOAD_IN_MEMORY_LIMIT / (1024 * 1024)
        ));
    }
    let app_for_stream = app.clone();
    let progress_event_for_stream = progress_event.clone();

    let mut body = resp;

    let mut result = Vec::new();
    let mut received: u64 = 0;

    loop {
        match body.chunk().await {
            Ok(Some(chunk)) => {
                received += chunk.len() as u64;
                // Guard against a missing Content-Length (chunked) growing
                // without bound.
                if received > DOWNLOAD_IN_MEMORY_LIMIT {
                    return Err(format!(
                        "FILE_TOO_LARGE: response exceeded {} MB limit",
                        DOWNLOAD_IN_MEMORY_LIMIT / (1024 * 1024)
                    ));
                }
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

fn safe_download_name(filename: &str) -> String {
    // Take the last path segment explicitly for BOTH separators so behavior is
    // identical on every OS (on Windows '\' is a separator, on macOS/Linux it
    // is a literal character — Path::file_name differs between platforms).
    let stem = filename
        .split(['/', '\\'])
        .rfind(|segment| !segment.is_empty());
    stem.filter(|name| *name != "." && *name != "..")
        .unwrap_or("download")
        .to_string()
}

async fn unique_download_path(directory: &Path, filename: &str) -> Result<PathBuf, String> {
    let initial = directory.join(filename);
    if !initial.try_exists().map_err(|e| format!("DOWNLOAD_PATH_ERROR: {e}"))? {
        return Ok(initial);
    }
    let file = Path::new(filename);
    let stem = file.file_stem().and_then(|value| value.to_str()).unwrap_or("download");
    let extension = file.extension().and_then(|value| value.to_str()).map(|value| format!(".{value}")).unwrap_or_default();
    for index in 1..10_000 {
        let candidate = directory.join(format!("{stem} ({index}){extension}"));
        if !candidate.try_exists().map_err(|e| format!("DOWNLOAD_PATH_ERROR: {e}"))? {
            return Ok(candidate);
        }
    }
    Err("DOWNLOAD_PATH_ERROR: unable to create a unique file name".to_string())
}

/// `invoke("download_file_to_downloads", { path, filename, progressId? })`
///
/// Streams the HTTP response directly to the platform Downloads directory.
/// Unlike `download_file`, this never builds the complete payload in memory.
#[tauri::command]
pub async fn download_file_to_downloads(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    path: String,
    filename: String,
    progress_id: Option<String>,
) -> Result<String, String> {
    let (token, server_url) = require_session(&app)?;
    let progress_id = progress_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let progress_event = format!("{}{}", FILE_PROGRESS_EVENT_PREFIX, progress_id);
    let mut url = url::Url::parse(&format!("{}/files/download", server_url))
        .map_err(|e| format!("URL_ERROR: {e}"))?;
    url.query_pairs_mut().append_pair("path", &path);
    let response = state.client.get(url).header("x-session-token", token).send().await
        .map_err(|e| format!("SERVER_UNREACHABLE: {e}"))?;
    if !response.status().is_success() {
        return Err(describe_http_error(response, "download file").await);
    }

    let downloads = app.path().download_dir()
        .map_err(|e| format!("DOWNLOAD_PATH_ERROR: {e}"))?;
    tokio::fs::create_dir_all(&downloads).await.map_err(|e| format!("DOWNLOAD_PATH_ERROR: {e}"))?;
    let destination = unique_download_path(&downloads, &safe_download_name(&filename)).await?;
    let temporary = destination.with_extension(format!("{}.loza-part", uuid::Uuid::new_v4()));
    let total = response.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(&temporary).await.map_err(|e| format!("DOWNLOAD_WRITE_ERROR: {e}"))?;
    let mut stream = response.bytes_stream();
    let mut received = 0u64;

    while let Some(chunk) = futures_util::StreamExt::next(&mut stream).await {
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(error) => {
                let _ = tokio::fs::remove_file(&temporary).await;
                return Err(format!("READ_ERROR: {error}"));
            }
        };
        if let Err(error) = file.write_all(&chunk).await {
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(format!("DOWNLOAD_WRITE_ERROR: {error}"));
        }
        received += chunk.len() as u64;
        let _ = app.emit(&progress_event, serde_json::json!({ "received": received, "total": total }));
    }
    if let Err(error) = file.flush().await {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(format!("DOWNLOAD_WRITE_ERROR: {error}"));
    }
    drop(file);
    if let Err(error) = tokio::fs::rename(&temporary, &destination).await {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(format!("DOWNLOAD_WRITE_ERROR: {error}"));
    }
    let _ = app.emit(&progress_event, serde_json::json!({ "received": received, "total": total.max(received) }));
    Ok(destination.to_string_lossy().into_owned())
}

#[cfg(test)]
mod download_tests {
    use super::safe_download_name;

    #[test]
    fn download_name_cannot_escape_the_download_directory() {
        assert_eq!(safe_download_name("../../secret.txt"), "secret.txt");
        assert_eq!(safe_download_name("folder\\report.pdf"), "report.pdf");
        assert_eq!(safe_download_name("C:\\temp\\report.pdf"), "report.pdf");
        assert_eq!(safe_download_name("folder/report.pdf"), "report.pdf");
        assert_eq!(safe_download_name(""), "download");
        assert_eq!(safe_download_name(".."), "download");
    }
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

/// `invoke("mutate_files", { operation, paths, destination? })`
///
/// A single HTTP request for a multi-selection operation. The server owns
/// conflict naming and returns a result for every input path, so React never
/// guesses which files actually changed.
#[tauri::command]
pub async fn mutate_files(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    operation: String,
    paths: Vec<String>,
    destination: Option<String>,
) -> Result<BatchResponse, String> {
    let (token, server_url) = require_session(&app)?;
    let operation = match operation.as_str() {
        "copy" => BatchOperation::Copy,
        "move" => BatchOperation::Move,
        "delete" => BatchOperation::Delete,
        _ => return Err("INVALID_BATCH: unsupported operation".to_string()),
    };
    let request = BatchRequest { operation, paths, destination };
    let response = state.client
        .post(format!("{}/files/batch", server_url))
        .header("x-session-token", token)
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;
    if !response.status().is_success() {
        return Err(describe_http_error(response, "mutate files").await);
    }
    response.json::<BatchResponse>()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))
}
