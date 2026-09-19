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
use crate::ws_client::{FILE_CHANGE_EVENT, FILE_PROGRESS_EVENT_PREFIX};

/// `app.emit(FILE_CHANGE_EVENT, ...)` — синхронный fallback для обновления
/// списка файлов, когда WS-канал недоступен. Backend шлёт те же события по WS,
/// дублирование безопасно: фронт просто перезагружает текущую папку.
fn emit_file_change(app: &AppHandle, operation: &str, path: &str) {
    let _ = app.emit(
        FILE_CHANGE_EVENT,
        serde_json::json!({ "source": "desktop", "operation": operation, "path": path }),
    );
}

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
    /// SHA-256 контента (hex). Отсутствует для директорий и файлов, загруженных
    /// до миграции 0004 — поэтому `default`, чтобы старые ответы парсились.
    #[serde(default)]
    pub sha256: Option<String>,
}

/// Share-ссылка пользователя (зеркало backend ShareInfo, camelCase).
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareInfo {
    pub id: String,
    pub token: String,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub is_active: bool,
    /// Ссылка защищена паролем. `default` — чтобы десктоп-клиент не падал
    /// при ответе старого backend, не знающего это поле.
    #[serde(default)]
    pub has_password: bool,
}

/// Ответ `create_share`: сама ссылка + готовый к передаче URL.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedShare {
    pub share: ShareInfo,
    pub url: String,
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

#[derive(Debug, Clone, Copy, Serialize)]
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

// ─── Shares ──────────────────────────────────────────────────────────────────

/// `invoke("create_share", { path, password? })` — создаёт публичную ссылку
/// на файл или директорию. Возвращает токен и полный URL вида
/// `<server>/share/<token>`.
#[tauri::command]
pub async fn create_share(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    path: String,
    password: Option<String>,
) -> Result<CreatedShare, String> {
    let (token, server_url) = require_session(&app)?;

    let resp = state
        .client
        .post(format!("{}/files/share", server_url))
        .header("x-session-token", token)
        .json(&serde_json::json!({ "path": path, "password": password }))
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;

    if !resp.status().is_success() {
        return Err(describe_http_error(resp, "create share").await);
    }

    let share: ShareInfo = resp
        .json()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))?;
    Ok(CreatedShare {
        url: format!("{}/share/{}", server_url, share.token),
        share,
    })
}

/// `invoke("list_shares", { path? })` — ссылки на файл (или все ссылки
/// пользователя, если path пустой).
#[tauri::command]
pub async fn list_shares(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    path: Option<String>,
) -> Result<Vec<ShareInfo>, String> {
    let (token, server_url) = require_session(&app)?;

    let mut url = url::Url::parse(&format!("{}/files/shares", server_url))
        .map_err(|e| format!("URL_ERROR: {}", e))?;
    url.query_pairs_mut()
        .append_pair("path", path.as_deref().unwrap_or(""));

    let resp = state
        .client
        .get(url.as_str())
        .header("x-session-token", token)
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;

    if !resp.status().is_success() {
        return Err(describe_http_error(resp, "list shares").await);
    }

    resp.json::<Vec<ShareInfo>>()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))
}

/// `invoke("revoke_share", { token })` — отзывает ссылку (только владелец).
#[tauri::command]
pub async fn revoke_share(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    token: String,
) -> Result<(), String> {
    let (session_token, server_url) = require_session(&app)?;

    let mut url = url::Url::parse(&format!("{}/files/share/revoke", server_url))
        .map_err(|e| format!("URL_ERROR: {}", e))?;
    url.query_pairs_mut().append_pair("token", &token);

    let resp = state
        .client
        .delete(url.as_str())
        .header("x-session-token", session_token)
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;

    if !resp.status().is_success() {
        return Err(describe_http_error(resp, "revoke share").await);
    }

    Ok(())
}

/// `invoke("get_share_url", { token })` — строит публичный URL ссылки.
#[tauri::command]
pub fn get_share_url(
    app: AppHandle,
    token: String,
) -> Result<String, String> {
    let server_url = server_config::require_server_url(&app)?;
    Ok(format!("{}/share/{}", server_url, token))
}


/// `invoke("upload_file", { path, filename, data, overwrite?, progressId? })`
/// `data` is a `Vec<u8>` containing the file content.
/// `progressId` (optional) - UUID from the frontend to correlate progress events.
/// `overwrite` (optional) - if true, replaces existing file.
///
/// Emits progress events on `file-progress-{progressId}` with `{ sent, total }`.
/// Отменяется через `invoke("cancel_transfer", { progressId })`.
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
    let cancel = state.transfers.register(&progress_id);

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
        .text("progressId", progress_id.clone())
        .part(
            "file",
            reqwest::multipart::Part::stream(body)
                .file_name(filename.clone()),
        );

    // file_client не имеет общего таймаута: большие файлы загружаются долго.
    // Отмена через cancel_transfer снимает флаг — футур запроса роняется,
    // сервер видит оборванное multipart-тело и чистит свой temp-файл.
    let request_send = state
        .file_client
        .post(format!("{}/files/upload", server_url))
        .header("x-session-token", token)
        .multipart(form)
        .send();
    tokio::pin!(request_send);

    let resp = tokio::select! {
        result = &mut request_send => match result {
            Ok(resp) => resp,
            Err(e) => {
                progress_handle.abort();
                state.transfers.finish(&progress_id);
                return Err(format!("SERVER_UNREACHABLE: {}", e));
            }
        },
        _ = cancel.cancelled() => {
            progress_handle.abort();
            state.transfers.finish(&progress_id);
            return Err("CANCELLED".to_string());
        }
    };

    // Ensure the progress task has completed
    progress_handle.abort();
    state.transfers.finish(&progress_id);

    if !resp.status().is_success() {
        return Err(describe_http_error(resp, "upload file").await);
    }

    let info: FileInfo = resp
        .json()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))?;
    emit_file_change(&app, "upload", &info.path);
    Ok(info)
}

/// `invoke("upload_file_path", { osPath, destination, progressId, overwrite? })`
///
/// Стриминговый upload одного файла по абсолютному пути OS (диалог выбора
/// файлов). Файл читается с диска и уходит на сервер потоком, без
/// материализации в памяти → большие файлы больше не роняют приложение.
/// Прогресс идёт через `file-progress-{progressId}`, отмена — через
/// `cancel_transfer(progressId)`.
#[tauri::command]
pub async fn upload_file_path(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    os_path: String,
    destination: String,
    progress_id: String,
    overwrite: Option<bool>,
) -> Result<FileInfo, String> {
    let (token, server_url) = require_session(&app)?;
    let os_path_buf = std::path::PathBuf::from(&os_path);
    let filename = os_path_buf
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| "INVALID_PATH: no file name".to_string())?
        .to_string();

    let metadata = tokio::fs::metadata(&os_path_buf)
        .await
        .map_err(|e| format!("OPEN_ERROR: {e}"))?;
    if metadata.is_dir() {
        return Err("IS_DIRECTORY: directories are not uploaded".to_string());
    }
    let file = tokio::fs::File::open(&os_path_buf)
        .await
        .map_err(|e| format!("OPEN_ERROR: {e}"))?;

    let total = metadata.len();
    let progress_event = format!("{}{}", FILE_PROGRESS_EVENT_PREFIX, progress_id);
    let cancel = state.transfers.register(&progress_id);

    // Прогресс-обёртка над ReaderStream: считаем байты и эмитим события.
    let sent = Arc::new(AtomicU64::new(0));
    let app_for_stream = app.clone();
    let event_for_stream = progress_event.clone();
    let stream = tokio_util::io::ReaderStream::new(file);
    let body = reqwest::Body::wrap_stream(futures_util::StreamExt::map(
        stream,
        move |chunk| -> Result<tokio_util::bytes::Bytes, std::io::Error> {
            let chunk = chunk?;
            if !chunk.is_empty() {
                let new_sent = sent.fetch_add(chunk.len() as u64, Ordering::SeqCst) + chunk.len() as u64;
                let _ = app_for_stream.emit(
                    &event_for_stream,
                    serde_json::json!({ "sent": new_sent, "total": total }),
                );
            }
            Ok(chunk)
        },
    ));

    let form = reqwest::multipart::Form::new()
        .text("path", destination)
        .text("overwrite", overwrite.unwrap_or(false).to_string())
        .text("progressId", progress_id.clone())
        .part(
            "file",
            reqwest::multipart::Part::stream(body).file_name(filename),
        );

    let request_send = state
        .file_client
        .post(format!("{}/files/upload", server_url))
        .header("x-session-token", token)
        .multipart(form)
        .send();
    tokio::pin!(request_send);

    let resp = tokio::select! {
        result = &mut request_send => match result {
            Ok(resp) => resp,
            Err(e) => {
                state.transfers.finish(&progress_id);
                return Err(format!("SERVER_UNREACHABLE: {}", e));
            }
        },
        _ = cancel.cancelled() => {
            state.transfers.finish(&progress_id);
            return Err("CANCELLED".to_string());
        }
    };
    state.transfers.finish(&progress_id);

    let _ = app.emit(
        &progress_event,
        serde_json::json!({ "sent": total, "total": total }),
    );

    if !resp.status().is_success() {
        return Err(describe_http_error(resp, "upload file").await);
    }

    let info: FileInfo = resp
        .json()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))?;
    emit_file_change(&app, "upload", &info.path);
    Ok(info)
}

/// Результат загрузки одного файла по абсолютному пути (drag&drop из OS).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathUploadResult {
    pub filename: String,
    pub success: bool,
    pub message: Option<String>,
    pub target_path: Option<String>,
}

/// `invoke("upload_paths", { paths, destination? })`
///
/// Загружает файлы по абсолютным путям операционной системы — это путь для
/// drag&drop из Finder/Explorer. WebView не может читать содержимое файла по
/// пути, поэтому файлы стримятся с диска на сервер прямо из Rust, без
/// материализации в памяти приложения. Директории пропускаются. Ошибка одного
/// файла не прерывает остальные — результат возвращается по каждому пути.
#[tauri::command]
pub async fn upload_paths(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    paths: Vec<String>,
    destination: Option<String>,
) -> Result<Vec<PathUploadResult>, String> {
    let (token, server_url) = require_session(&app)?;
    let destination = destination.unwrap_or_default();
    if paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut results = Vec::with_capacity(paths.len());
    for raw in paths {
        let path = std::path::PathBuf::from(&raw);
        let filename = match path.file_name().and_then(|name| name.to_str()) {
            Some(name) if !name.is_empty() => name.to_string(),
            _ => continue,
        };
        let metadata = match tokio::fs::metadata(&path).await {
            Ok(metadata) => metadata,
            Err(e) => {
                results.push(PathUploadResult { filename, success: false, message: Some(format!("OPEN_ERROR: {e}")), target_path: None });
                continue;
            }
        };
        if metadata.is_dir() {
            // Папки не загружаем (при drag&drop папок их пропускаем).
            continue;
        }
        let file = match tokio::fs::File::open(&path).await {
            Ok(file) => file,
            Err(e) => {
                results.push(PathUploadResult { filename, success: false, message: Some(format!("OPEN_ERROR: {e}")), target_path: None });
                continue;
            }
        };

        let stream = reqwest::Body::wrap_stream(tokio_util::io::ReaderStream::new(file));
        let progress_id = uuid::Uuid::new_v4().to_string();
        let form = reqwest::multipart::Form::new()
            .text("path", destination.clone())
            .text("overwrite", "false")
            .text("progressId", progress_id.clone())
            .part(
                "file",
                reqwest::multipart::Part::stream(stream).file_name(filename.clone()),
            );

        let resp = match state
            .file_client
            .post(format!("{}/files/upload", server_url))
            .header("x-session-token", token.as_str())
            .multipart(form)
            .send()
            .await
        {
            Ok(resp) => resp,
            Err(e) => {
                results.push(PathUploadResult { filename, success: false, message: Some(format!("SERVER_UNREACHABLE: {e}")), target_path: None });
                continue;
            }
        };

        if !resp.status().is_success() {
            results.push(PathUploadResult { filename, success: false, message: Some(describe_http_error(resp, "upload file").await), target_path: None });
            continue;
        }

        match resp.json::<FileInfo>().await {
            Ok(info) => {
                emit_file_change(&app, "upload", &info.path);
                results.push(PathUploadResult { filename, success: true, message: None, target_path: Some(info.path) });
                let _ = app.emit(
                    &format!("{}{}", FILE_PROGRESS_EVENT_PREFIX, progress_id),
                    serde_json::json!({ "sent": metadata.len(), "total": metadata.len() }),
                );
            }
            Err(e) => {
                results.push(PathUploadResult { filename, success: false, message: Some(format!("PARSE_ERROR: {e}")), target_path: None });
            }
        }
    }

    Ok(results)
}

/// `invoke("download_file", { path, progressId? })`
/// Returns the raw bytes of the file as a `Vec<u8>`.
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
        .file_client
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
    let cancel = state.transfers.register(&progress_id);

    let mut body = resp;

    let mut result = Vec::new();
    let mut received: u64 = 0;

    loop {
        let chunk = tokio::select! {
            value = body.chunk() => value,
            _ = cancel.cancelled() => {
                state.transfers.finish(&progress_id);
                return Err("CANCELLED".to_string());
            }
        };
        match chunk {
            Ok(Some(chunk)) => {
                received += chunk.len() as u64;
                // Guard against a missing Content-Length (chunked) growing
                // without bound.
                if received > DOWNLOAD_IN_MEMORY_LIMIT {
                    state.transfers.finish(&progress_id);
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
            Err(e) => {
                state.transfers.finish(&progress_id);
                return Err(format!("READ_ERROR: {}", e));
            }
        }
    }
    state.transfers.finish(&progress_id);

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
    let response = state.file_client.get(url).header("x-session-token", token).send().await
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
    let cancel = state.transfers.register(&progress_id);

    loop {
        let next = tokio::select! {
            value = futures_util::StreamExt::next(&mut stream) => value,
            _ = cancel.cancelled() => {
                let _ = tokio::fs::remove_file(&temporary).await;
                state.transfers.finish(&progress_id);
                return Err("CANCELLED".to_string());
            }
        };
        let Some(chunk) = next else { break };
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(error) => {
                let _ = tokio::fs::remove_file(&temporary).await;
                state.transfers.finish(&progress_id);
                return Err(format!("READ_ERROR: {error}"));
            }
        };
        if let Err(error) = file.write_all(&chunk).await {
            let _ = tokio::fs::remove_file(&temporary).await;
            state.transfers.finish(&progress_id);
            return Err(format!("DOWNLOAD_WRITE_ERROR: {error}"));
        }
        received += chunk.len() as u64;
        let _ = app.emit(&progress_event, serde_json::json!({ "received": received, "total": total }));
    }
    state.transfers.finish(&progress_id);

    if total > 0 && received != total {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(format!("DOWNLOAD_INCOMPLETE: received {received} of {total} bytes"));
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

    emit_file_change(&app, "delete", &path);
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

    let info: FileInfo = resp
        .json()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))?;
    emit_file_change(&app, "rename", &info.path);
    Ok(info)
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

    let info: FileInfo = resp
        .json()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))?;
    emit_file_change(&app, "move", &info.path);
    Ok(info)
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

    let info: FileInfo = resp
        .json()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))?;
    emit_file_change(&app, "copy", &info.path);
    Ok(info)
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

    let info: FileInfo = resp
        .json()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))?;
    emit_file_change(&app, "mkdir", &info.path);
    Ok(info)
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
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        // Старый сервер без /files/batch (до введения batch-эндпоинта):
        // деградируем до пер-файловых операций, чтобы удаление/копирование/
        // вставка продолжали работать и после обновления десктоп-клиента.
        return batch_fallback(app, state, operation, request.paths.clone(), request.destination).await;
    }
    if !response.status().is_success() {
        return Err(describe_http_error(response, "mutate files").await);
    }
    let operation_label = match operation {
        BatchOperation::Copy => "copy",
        BatchOperation::Move => "move",
        BatchOperation::Delete => "delete",
    };
    emit_file_change(
        &app,
        operation_label,
        request.destination.as_deref().unwrap_or_default(),
    );
    response.json::<BatchResponse>()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))
}

/// Вспомогательный пер-файловый фолбэк для серверов без `/files/batch`.
///
/// Поведение повторяет semantics batch-операций: результат по каждому пути,
/// независимость элементов, имени с правкой конфликтов (`name (2)`), но через
/// одиночные эндпоинты /files/delete, /files/copy, /files/move. Имена занятых
/// в директории-назначении берутся из списка файлов этой директории один раз.
async fn batch_fallback(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    operation: BatchOperation,
    paths: Vec<String>,
    destination: Option<String>,
) -> Result<BatchResponse, String> {
    let (token, server_url) = require_session(&app)?;
    let dest = destination.unwrap_or_default();

    // Уже занятые имена в назначении, чтобы выбрать свободное целевое имя.
    let mut taken: std::collections::HashSet<String> = match list_destination_names(&state.client, &server_url, &token, &dest).await {
        Some(names) => names.into_iter().collect(),
        None => std::collections::HashSet::new(),
    };

    let operation_str = match operation {
        BatchOperation::Copy => "copy",
        BatchOperation::Move => "move",
        BatchOperation::Delete => "delete",
    };
    let mut results = Vec::with_capacity(paths.len());

    for path in paths {
        match operation {
            BatchOperation::Delete => {
                let mut url = match url::Url::parse(&format!("{}/files/delete", server_url)) {
                    Ok(url) => url,
                    Err(e) => {
                        results.push(batch_error(BatchOperation::Delete, &path, &format!("URL_ERROR: {e}")));
                        continue;
                    }
                };
                url.query_pairs_mut().append_pair("path", &path);
                let resp = match state.client.delete(url.as_str()).header("x-session-token", token.as_str()).send().await {
                    Ok(resp) => resp,
                    Err(e) => {
                        results.push(batch_error(BatchOperation::Delete, &path, &format!("SERVER_UNREACHABLE: {e}")));
                        continue;
                    }
                };
                if resp.status().is_success() {
                    results.push(BatchItemResult { path, target_path: None, success: true, error: None, file: None });
                } else {
                    results.push(batch_error(BatchOperation::Delete, &path, &describe_http_error(resp, "delete file").await));
                }
            }
            BatchOperation::Copy | BatchOperation::Move => {
                // Move в ту же директорию — no-op (как в /files/batch).
                if matches!(operation, BatchOperation::Move) {
                    let parent = path.rsplit_once('/').map(|(p, _)| p.to_string()).unwrap_or_default();
                    if parent == dest {
                        results.push(BatchItemResult { path: path.clone(), target_path: Some(path.clone()), success: true, error: None, file: None });
                        continue;
                    }
                }
                let name = path.rsplit('/').next().unwrap_or(&path).to_string();
                let target = fallback_target_name(&dest, &name, &mut taken);
                let endpoint = if matches!(operation, BatchOperation::Copy) { "copy" } else { "move" };
                let body = serde_json::json!({ "from": path.clone(), "to": target });
                let resp = match state.client
                    .post(format!("{}/files/{endpoint}", server_url))
                    .header("x-session-token", token.as_str())
                    .json(&body)
                    .send()
                    .await
                {
                    Ok(resp) => resp,
                    Err(e) => {
                        results.push(batch_error(operation, &path, &format!("SERVER_UNREACHABLE: {e}")));
                        continue;
                    }
                };
                if !resp.status().is_success() {
                    results.push(batch_error(operation, &path, &describe_http_error(resp, operation_str).await));
                    continue;
                }
                match resp.json::<FileInfo>().await {
                    Ok(info) => results.push(BatchItemResult {
                        path,
                        target_path: Some(target),
                        success: true,
                        error: None,
                        file: Some(info),
                    }),
                    Err(e) => results.push(batch_error(operation, &path, &format!("PARSE_ERROR: {e}"))),
                }
            }
        }
    }

    emit_file_change(&app, operation_str, &dest);
    Ok(BatchResponse { operation: operation_str.to_string(), results })
}

fn batch_error(operation: BatchOperation, path: &str, message: &str) -> BatchItemResult {
    let target_path = match operation {
        BatchOperation::Copy | BatchOperation::Move => Some(path.to_string()),
        BatchOperation::Delete => None,
    };
    BatchItemResult { path: path.to_string(), target_path, success: false, error: Some(message.to_string()), file: None }
}

/// Список путей в директории-назначении (для выбора свободного имени при
/// фолбэке). Считаем отсутствие списка некритичным: ошибочные попытки будут
/// отдельно отражены в результатах batch.
async fn list_destination_names(client: &reqwest::Client, server_url: &str, token: &str, dest: &str) -> Option<Vec<String>> {
    let mut url = url::Url::parse(&format!("{}/files/list", server_url)).ok()?;
    url.query_pairs_mut().append_pair("path", dest);
    let resp = client.get(url.as_str()).header("x-session-token", token).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let files: Vec<FileInfo> = resp.json().await.ok()?;
    Some(files.into_iter().map(|file| file.path).collect())
}

/// Выбирает свободное имя в destination: `name`, затем `stem (2)ext`, и т.д.
fn fallback_target_name(destination: &str, name: &str, taken: &mut std::collections::HashSet<String>) -> String {
    let (stem, extension) = match name.rfind('.') {
        Some(index) if index > 0 => (&name[..index], &name[index..]),
        _ => (name, ""),
    };
    let make = |num: u32| {
        let candidate = if num == 1 { name.to_string() } else { format!("{stem} ({num}){extension}") };
        if destination.is_empty() {
            candidate
        } else {
            format!("{destination}/{candidate}")
        }
    };
    let mut index = 1u32;
    let mut candidate = make(1);
    while taken.contains(&candidate) {
        index += 1;
        if index > 10_000 {
            break;
        }
        candidate = make(index);
    }
    taken.insert(candidate.clone());
    candidate
}
