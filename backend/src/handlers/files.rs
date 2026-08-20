//! REST API для файлового хранилища пользователя.
//!
//! Архитектура:
//! - Метаданные файлов хранятся в Postgres (таблица `user_files`).
//! - Сами файлы лежат на диске в `storage/<username>/<path>`.
//! - Передача файлов — через HTTP (streaming, Range support). WebSocket
//!   используется только для push-уведомлений об изменениях.
//! - Авторизация через существующий `require_session` (x-session-token).
//!
//! Маршруты (все требуют аутентификации):
//!   GET    /files/list?path=<dir>     — список файлов в директории
//!   GET    /files/info?path=<path>    — метаданные файла
//!   POST   /files/upload              — загрузка (multipart, streaming)
//!   GET    /files/download?path=<p>   — скачивание (с Range support)
//!   GET    /files/view?path=<p>       — просмотр (inline, с Range)
//!   DELETE /files/delete?path=<p>     — удаление
//!   POST   /files/rename              — переименование
//!   POST   /files/move                — перемещение
//!   POST   /files/copy                — копирование
//!   POST   /files/mkdir               — создание директории

use axum::extract::Multipart;
use axum::http::header::{ACCEPT_RANGES, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, RANGE};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{Json, Response};
use axum::{body::Body, extract::Query, extract::State};
use chrono::Utc;
use futures_util::StreamExt;
use serde::Deserialize;
use sqlx::FromRow;
use std::path::PathBuf;
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use crate::db::{storage_fs, AppState};
use crate::handlers::auth::{ErrorResponse, require_session};
use crate::models::{FileError, FileInfo, fmt_ts, guess_mime, sanitize_path, split_parent};

type ApiError = (StatusCode, Json<ErrorResponse>);

fn file_error(err: FileError) -> ApiError {
    let status = match err.code.as_str() {
        "FILE_NOT_FOUND" | "IO_NOT_FOUND" => StatusCode::NOT_FOUND,
        "PATH_EXISTS" => StatusCode::CONFLICT,
        "INVALID_PATH" => StatusCode::BAD_REQUEST,
        "IS_DIRECTORY" | "NOT_A_DIRECTORY" => StatusCode::UNPROCESSABLE_ENTITY,
        "IO_PERMISSION_DENIED" => StatusCode::FORBIDDEN,
        "DATABASE_UNAVAILABLE" => StatusCode::SERVICE_UNAVAILABLE,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (
        status,
        Json(ErrorResponse {
            error: err.message,
            code: err.code,
        }),
    )
}

fn from_file_error(err: FileError) -> ApiError {
    file_error(err)
}

async fn require_username(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<String, ApiError> {
    require_session(state, headers)
        .await
        .map(|(claims, _)| claims.sub)
}

/// Корень директории пользователя на диске: storage/<username>/
fn user_root(username: &str) -> PathBuf {
    let safe: String = username
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    storage_fs::storage_root().join(safe)
}

/// Внутренняя модель для SQLx.
#[derive(Debug, FromRow)]
struct FileRow {
    id: String,
    path: String,
    name: String,
    is_dir: bool,
    size_bytes: i64,
    mime_type: Option<String>,
    created_at: i64,
    updated_at: i64,
}

impl From<FileRow> for FileInfo {
    fn from(row: FileRow) -> Self {
        FileInfo {
            id: row.id,
            path: row.path,
            name: row.name,
            is_dir: row.is_dir,
            size_bytes: row.size_bytes.max(0) as u64,
            mime_type: row.mime_type,
            created_at: fmt_ts(row.created_at),
            updated_at: fmt_ts(row.updated_at),
        }
    }
}

#[derive(Debug, FromRow)]
struct FileMetaRow {
    #[allow(dead_code)]
    path: String,
    name: String,
    mime_type: Option<String>,
    size_bytes: i64,
}

// ─── Query params ─────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    #[serde(default)]
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct FileQuery {
    pub path: String,
}

// ─── Handlers ─────────────────────────────────────────────────────────────

/// GET /files/list?path=<dir>
pub async fn list_files(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ListQuery>,
) -> Result<Json<Vec<FileInfo>>, ApiError> {
    let username = require_username(&state, &headers).await?;
    let dir_path = if query.path.is_empty() {
        ".".to_string()
    } else {
        sanitize_path(&query.path).map_err(from_file_error)?
    };

    let dir_prefix = if dir_path == "." {
        String::new()
    } else if dir_path.ends_with('/') {
        dir_path.clone()
    } else {
        format!("{dir_path}/")
    };

    let rows: Vec<FileRow> = if dir_prefix.is_empty() {
        sqlx::query_as(
            r#"SELECT id, path, name, is_dir, size_bytes, mime_type, created_at, updated_at
               FROM user_files
               WHERE username = $1
                 AND path NOT LIKE $2
               ORDER BY (CASE WHEN is_dir THEN 0 ELSE 1 END), name"#,
        )
        .bind(&username)
        .bind("%/%")
        .fetch_all(&state.pool)
        .await
        .map_err(FileError::from)
        .map_err(file_error)?
    } else {
        sqlx::query_as(
            r#"SELECT id, path, name, is_dir, size_bytes, mime_type, created_at, updated_at
               FROM user_files
               WHERE username = $1
                 AND path LIKE $2
                 AND path NOT LIKE $3
               ORDER BY (CASE WHEN is_dir THEN 0 ELSE 1 END), name"#,
        )
        .bind(&username)
        .bind(format!("{dir_prefix}%"))
        .bind(format!("{dir_prefix}%/%"))
        .fetch_all(&state.pool)
        .await
        .map_err(FileError::from)
        .map_err(file_error)?
    };

    let files: Vec<FileInfo> = rows.into_iter().map(FileInfo::from).collect();
    Ok(Json(files))
}

/// GET /files/info?path=<path>
pub async fn file_info(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<FileQuery>,
) -> Result<Json<FileInfo>, ApiError> {
    let username = require_username(&state, &headers).await?;
    let path = sanitize_path(&query.path).map_err(from_file_error)?;

    let row = sqlx::query_as::<_, FileRow>(
        r#"SELECT id, path, name, is_dir, size_bytes, mime_type, created_at, updated_at
           FROM user_files WHERE username = $1 AND path = $2"#,
    )
    .bind(&username)
    .bind(&path)
    .fetch_optional(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(file_error)?;

    match row {
        Some(row) => Ok(Json(FileInfo::from(row))),
        None => Err(file_error(FileError::not_found(&path))),
    }
}

/// POST /files/upload
/// Multipart: поле `file` (файл), поле `path` (директория назначения, опционально).
/// Для больших файлов использует потоковую запись на диск.
pub async fn upload_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<FileInfo>, ApiError> {
    let username = require_username(&state, &headers).await?;
    let _ = sanitize_path(&username).map_err(from_file_error)?;

    let mut dest_dir = String::new();
    let mut total_size: u64 = 0;
    let mut result: Option<FileInfo> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| file_error(FileError::new("PARSE_ERROR", &format!("Multipart error: {e}"))))?
    {
        let field_name = field.name().map(|n| n.to_string()).unwrap_or_default();
        let field = field;

        if field_name == "path" {
            dest_dir = field.text().await.unwrap_or_default();
            continue;
        }

        // file field
        let fname = field
            .file_name()
            .map(|f| f.to_string())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let ct = field.content_type().map(|c| c.to_string());

        let final_path = if dest_dir.is_empty() {
            fname.clone()
        } else {
            format!("{dest_dir}/{fname}")
        };
        let clean_path = sanitize_path(&final_path).map_err(from_file_error)?;
        let disk_path = user_root(&username).join(&clean_path);

        if let Some(parent) = disk_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(FileError::from)
                .map_err(file_error)?;
        }

        if disk_path.try_exists().unwrap_or(false) {
            return Err(file_error(FileError::conflict(&clean_path)));
        }

        let mut file = tokio::fs::File::create(&disk_path)
            .await
            .map_err(FileError::from)
            .map_err(file_error)?;

        let mut stream = field;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| file_error(FileError::new("STREAM_ERROR", &format!("Read error: {e}"))))?;
            if !chunk.is_empty() {
                total_size += chunk.len() as u64;
                tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
                    .await
                    .map_err(FileError::from)
                    .map_err(file_error)?;
            }
        }
        tokio::io::AsyncWriteExt::flush(&mut file)
            .await
            .map_err(FileError::from)
            .map_err(file_error)?;

        let mime = ct.or_else(|| guess_mime(&fname).map(|s| s.to_string()));
        let dir_name = split_parent(&clean_path)
            .map(|(_, n)| n.to_string())
            .unwrap_or_else(|| fname.clone());

        let file_id = Uuid::new_v4();
        let now = Utc::now().timestamp();
        sqlx::query(
            r#"INSERT INTO user_files (id, username, path, name, is_dir, size_bytes, mime_type, created_at, updated_at)
               VALUES ($1, $2, $3, $4, false, $5, $6, $7, $8)"#,
        )
        .bind(file_id)
        .bind(&username)
        .bind(&clean_path)
        .bind(&dir_name)
        .bind(total_size as i64)
        .bind(mime.clone())
        .bind(now)
        .bind(now)
        .execute(&state.pool)
        .await
        .map_err(FileError::from)
        .map_err(file_error)?;

        result = Some(FileInfo {
            id: file_id.to_string(),
            path: clean_path.clone(),
            name: dir_name,
            is_dir: false,
            size_bytes: total_size,
            mime_type: mime,
            created_at: fmt_ts(now),
            updated_at: fmt_ts(now),
        });
        break; // обрабатываем первый файл
    }

    match result {
        Some(info) => Ok(Json(info)),
        None => Err(file_error(FileError::new(
            "PARSE_ERROR",
            "No file field found in multipart upload",
        ))),
    }
}

/// GET /files/download?path=<path>
/// Скачивание с поддержкой HTTP Range.
pub async fn download_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<FileQuery>,
) -> Result<Response, ApiError> {
    let username = require_username(&state, &headers).await?;
    let path = sanitize_path(&query.path).map_err(from_file_error)?;

    let row: FileMetaRow = sqlx::query_as(
        r#"SELECT path, name, mime_type, size_bytes FROM user_files
           WHERE username = $1 AND path = $2 AND is_dir = false"#,
    )
    .bind(&username)
    .bind(&path)
    .fetch_optional(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(file_error)?
    .ok_or_else(|| file_error(FileError::not_found(&path)))?;

    let name = row.name;
    let db_mime = row.mime_type;
    let size = row.size_bytes;
    let content_type = db_mime
        .or_else(|| guess_mime(&name).map(|s| s.to_string()))
        .unwrap_or_else(|| "application/octet-stream".to_string());

    let disk_path = user_root(&username).join(&path);
    let file = tokio::fs::File::open(&disk_path)
        .await
        .map_err(FileError::from)
        .map_err(file_error)?;

    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);
    let mut response = Response::new(body);

    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_str(&content_type).unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    response.headers_mut().insert(
        CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!(
            "attachment; filename=\"{}\"; filename*=UTF-8''{}",
            name,
            percent_encode(&name)
        )).unwrap_or_else(|_| HeaderValue::from_static("attachment")),
    );
    response.headers_mut().insert(ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    response.headers_mut().insert(
        CONTENT_LENGTH,
        HeaderValue::from_str(&size.to_string()).unwrap_or(HeaderValue::from_static("0")),
    );

    Ok(response)
}

/// GET /files/view?path=<path>
/// Просмотр файла (inline) с поддержкой Range для стриминга.
pub async fn view_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<FileQuery>,
) -> Result<Response, ApiError> {
    let username = require_username(&state, &headers).await?;
    let path = sanitize_path(&query.path).map_err(from_file_error)?;

    let row: FileMetaRow = sqlx::query_as(
        r#"SELECT path, name, mime_type, size_bytes FROM user_files
           WHERE username = $1 AND path = $2 AND is_dir = false"#,
    )
    .bind(&username)
    .bind(&path)
    .fetch_optional(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(file_error)?
    .ok_or_else(|| file_error(FileError::not_found(&path)))?;

    let name = row.name;
    let db_mime = row.mime_type;
    let size = row.size_bytes;
    let content_type = db_mime
        .or_else(|| guess_mime(&name).map(|s| s.to_string()))
        .unwrap_or_else(|| "application/octet-stream".to_string());

    let disk_path = user_root(&username).join(&path);
    let mut file = tokio::fs::File::open(&disk_path)
        .await
        .map_err(FileError::from)
        .map_err(file_error)?;

    // Parse Range header
    let range_header = headers.get(RANGE)
        .and_then(|v| v.to_str().ok());

    if let Some(rh) = range_header
        && let Some((start, end)) = parse_range(rh, size)
    {
        use tokio::io::{AsyncReadExt, AsyncSeekExt};
        file.seek(std::io::SeekFrom::Start(start))
            .await
            .map_err(FileError::from)
            .map_err(file_error)?;
        let end = end.min((size - 1) as u64);
        let len = end - start + 1;

        let stream = ReaderStream::with_capacity(file.take(len), 64 * 1024);
        let body = Body::from_stream(stream);
        let mut response = Response::new(body);

        response.headers_mut().insert(CONTENT_TYPE, HeaderValue::from_str(&content_type).unwrap_or(HeaderValue::from_static("application/octet-stream")));
        response.headers_mut().insert(ACCEPT_RANGES, HeaderValue::from_static("bytes"));
        response.headers_mut().insert(CONTENT_LENGTH, HeaderValue::from_str(&len.to_string()).unwrap_or(HeaderValue::from_static("0")));
        response.headers_mut().insert(CONTENT_RANGE, HeaderValue::from_str(&format!("bytes {start}-{end}/{size}")).unwrap_or(HeaderValue::from_static("")));
        *response.status_mut() = StatusCode::PARTIAL_CONTENT;
        return Ok(response);
    }

    // Full file
    let file = tokio::fs::File::open(&disk_path)
        .await
        .map_err(FileError::from)
        .map_err(file_error)?;
    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);
    let mut response = Response::new(body);

    response.headers_mut().insert(CONTENT_TYPE, HeaderValue::from_str(&content_type).unwrap_or(HeaderValue::from_static("application/octet-stream")));
    response.headers_mut().insert(ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    response.headers_mut().insert(CONTENT_LENGTH, HeaderValue::from_str(&size.to_string()).unwrap_or(HeaderValue::from_static("0")));

    Ok(response)
}

fn parse_range(range_header: &str, total_size: i64) -> Option<(u64, u64)> {
    if !range_header.starts_with("bytes=") {
        return None;
    }
    let range_str = &range_header[6..];
    let (start_str, end_str) = range_str.split_once('-')?;
    let start: u64 = start_str.parse().ok()?;
    let end: u64 = if end_str.is_empty() {
        total_size as u64 - 1
    } else {
        end_str.parse().ok()?
    };
    Some((start, end.min(total_size as u64 - 1)))
}

fn percent_encode(input: &str) -> String {
    use std::fmt::Write;
    let mut result = String::with_capacity(input.len() * 3);
    for byte in input.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            result.push(byte as char);
        } else {
            write!(&mut result, "%{byte:02X}").unwrap();
        }
    }
    result
}

/// DELETE /files/delete?path=<path>
pub async fn delete_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<FileQuery>,
) -> Result<StatusCode, ApiError> {
    let username = require_username(&state, &headers).await?;
    let path = sanitize_path(&query.path).map_err(from_file_error)?;

    let exists_count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM user_files WHERE username = $1 AND path = $2"#,
    )
    .bind(&username)
    .bind(&path)
    .fetch_one(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(file_error)?;

    if exists_count == 0 {
        return Err(file_error(FileError::not_found(&path)));
    }

    let root = user_root(&username);
    let disk_path = root.join(&path);

    // Delete from DB: the row + any children (for directories)
    let pattern = format!("{path}%");
    sqlx::query(
        r#"DELETE FROM user_files WHERE username = $1 AND (path = $2 OR path LIKE $3)"#,
    )
    .bind(&username)
    .bind(&path)
    .bind(&pattern)
    .execute(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(file_error)?;

    // Delete from disk
    if disk_path.is_dir() {
        tokio::fs::remove_dir_all(&disk_path)
            .await
            .map_err(FileError::from)
            .map_err(file_error)?;
    } else {
        tokio::fs::remove_file(&disk_path)
            .await
            .map_err(FileError::from)
            .map_err(file_error)?;
    }

    Ok(StatusCode::NO_CONTENT)
}

/// POST /files/rename  {"from": "<path>", "to": "<path>"}
pub async fn rename_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<crate::models::MoveRequest>,
) -> Result<Json<FileInfo>, ApiError> {
    let username = require_username(&state, &headers).await?;
    let from = sanitize_path(&req.from).map_err(from_file_error)?;
    let to = sanitize_path(&req.to).map_err(from_file_error)?;

    let row: Option<(String, String, bool, i64, Option<String>)> = sqlx::query_as(
        r#"SELECT id, name, is_dir, size_bytes, mime_type FROM user_files
           WHERE username = $1 AND path = $2"#,
    )
    .bind(&username)
    .bind(&from)
    .fetch_optional(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(file_error)?;

    let (id, _name, is_dir, size, mime) =
        row.ok_or_else(|| file_error(FileError::not_found(&from)))?;

    // Conflict check
    let conflict: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM user_files WHERE username = $1 AND path = $2"#,
    )
    .bind(&username)
    .bind(&to)
    .fetch_one(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(file_error)?;

    if conflict > 0 {
        return Err(file_error(FileError::conflict(&to)));
    }

    let root = user_root(&username);
    let disk_from = root.join(&from);
    let disk_to = root.join(&to);

    if let Some(parent) = disk_to.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(FileError::from)
            .map_err(file_error)?;
    }

    tokio::fs::rename(&disk_from, &disk_to)
        .await
        .map_err(FileError::from)
        .map_err(file_error)?;

    // Update DB: update the row AND children (directory rename)
    let now = Utc::now().timestamp();
    let old_prefix = if is_dir { format!("{from}/") } else { from.clone() };
    let new_prefix = if is_dir { format!("{to}/") } else { to.clone() };

    sqlx::query(
        r#"UPDATE user_files
           SET path = REPLACE(path, $1, $2), updated_at = $3
           WHERE username = $4 AND path LIKE $5"#,
    )
    .bind(&old_prefix)
    .bind(&new_prefix)
    .bind(now)
    .bind(&username)
    .bind(format!("{old_prefix}%"))
    .execute(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(file_error)?;

    let new_name = split_parent(&to)
        .map(|(_, n)| n.to_string())
        .unwrap_or_else(|| to.clone());

    Ok(Json(FileInfo {
        id,
        path: to.clone(),
        name: new_name,
        is_dir,
        size_bytes: size.max(0) as u64,
        mime_type: mime,
        created_at: fmt_ts(now),
        updated_at: fmt_ts(now),
    }))
}

/// POST /files/move  {"from": "<path>", "to": "<path>"}
pub async fn move_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<crate::models::MoveRequest>,
) -> Result<Json<FileInfo>, ApiError> {
    rename_file(State(state), headers, Json(req)).await
}

/// POST /files/copy  {"from": "<path>", "to": "<path>"}
pub async fn copy_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<crate::models::CopyRequest>,
) -> Result<Json<FileInfo>, ApiError> {
    let username = require_username(&state, &headers).await?;
    let from = sanitize_path(&req.from).map_err(from_file_error)?;
    let to = sanitize_path(&req.to).map_err(from_file_error)?;

    let row: Option<(String, bool, i64, Option<String>)> = sqlx::query_as(
        r#"SELECT name, is_dir, size_bytes, mime_type FROM user_files
           WHERE username = $1 AND path = $2"#,
    )
    .bind(&username)
    .bind(&from)
    .fetch_optional(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(file_error)?;

    let (name, is_dir, size, mime) =
        row.ok_or_else(|| file_error(FileError::not_found(&from)))?;

    // Conflict check
    let conflict: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM user_files WHERE username = $1 AND path = $2"#,
    )
    .bind(&username)
    .bind(&to)
    .fetch_one(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(file_error)?;

    if conflict > 0 {
        return Err(file_error(FileError::conflict(&to)));
    }

    let root = user_root(&username);
    let disk_from = root.join(&from);
    let disk_to = root.join(&to);

    if let Some(parent) = disk_to.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(FileError::from)
            .map_err(file_error)?;
    }

    if is_dir {
        copy_dir_recursive(&disk_from, &disk_to)
            .await
            .map_err(FileError::from)
            .map_err(file_error)?;
    } else {
        tokio::fs::copy(&disk_from, &disk_to)
            .await
            .map_err(FileError::from)
            .map_err(file_error)?;
    }

    let now = Utc::now().timestamp();

    // INSERT new DB record(s) for the copied file/directory.
    if is_dir {
        // Copy the directory row + all children rows with fresh UUIDs and new paths.
        sqlx::query(
            r#"INSERT INTO user_files (id, username, path, name, is_dir, size_bytes, mime_type, created_at, updated_at)
               SELECT gen_random_uuid(), $1,
                      REPLACE(path, $2, $3), name, is_dir, size_bytes, mime_type, $4, $4
               FROM user_files
               WHERE username = $1 AND path LIKE $5"#,
        )
        .bind(&username)
        .bind(&from)
        .bind(&to)
        .bind(now)
        .bind(format!("{from}%"))
        .execute(&state.pool)
        .await
        .map_err(FileError::from)
        .map_err(file_error)?;
    } else {
        sqlx::query(
            r#"INSERT INTO user_files (id, username, path, name, is_dir, size_bytes, mime_type, created_at, updated_at)
               VALUES (gen_random_uuid(), $1, $2, $3, false, $4, $5, $6, $6)"#,
        )
        .bind(&username)
        .bind(&to)
        .bind(&name)
        .bind(size)
        .bind(mime.clone())
        .bind(now)
        .execute(&state.pool)
        .await
        .map_err(FileError::from)
        .map_err(file_error)?;
    }

    let now_str = fmt_ts(now);
    Ok(Json(FileInfo {
        id: Uuid::new_v4().to_string(),
        path: to.clone(),
        name: name.clone(),
        is_dir,
        size_bytes: size.max(0) as u64,
        mime_type: mime,
        created_at: now_str.clone(),
        updated_at: now_str,
    }))
}

async fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    tokio::fs::create_dir_all(dst).await?;
    let mut entries = tokio::fs::read_dir(src).await?;
    while let Some(entry) = entries.next_entry().await? {
        let entry_path = entry.path();
        let dest_path = dst.join(entry.file_name());
        let file_type = entry.file_type().await?;
        if file_type.is_dir() {
            Box::pin(copy_dir_recursive(&entry_path, &dest_path)).await?;
        } else {
            tokio::fs::copy(&entry_path, &dest_path).await?;
        }
    }
    Ok(())
}

/// POST /files/mkdir  {"path": "<dir_path>"}
pub async fn create_dir(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<crate::models::CreateDirRequest>,
) -> Result<Json<FileInfo>, ApiError> {
    let username = require_username(&state, &headers).await?;
    let path = sanitize_path(&req.path).map_err(from_file_error)?;

    // Conflict check
    let conflict: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM user_files WHERE username = $1 AND path = $2"#,
    )
    .bind(&username)
    .bind(&path)
    .fetch_one(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(file_error)?;

    if conflict > 0 {
        return Err(file_error(FileError::conflict(&path)));
    }

    let dir_name = split_parent(&path)
        .map(|(_, n)| n.to_string())
        .unwrap_or_else(|| path.clone());

    let disk_path = user_root(&username).join(&path);
    tokio::fs::create_dir_all(&disk_path)
        .await
        .map_err(FileError::from)
        .map_err(file_error)?;

    let dir_id = Uuid::new_v4();
    let now = Utc::now().timestamp();
    sqlx::query(
        r#"INSERT INTO user_files (id, username, path, name, is_dir, size_bytes, mime_type, created_at, updated_at)
           VALUES ($1, $2, $3, $4, true, 0, $5, $6, $7)"#,
    )
    .bind(dir_id)
    .bind(&username)
    .bind(&path)
    .bind(&dir_name)
    .bind(Some("inode/directory".to_string()))
    .bind(now)
    .bind(now)
    .execute(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(file_error)?;

    let ts = fmt_ts(now);
    Ok(Json(FileInfo {
        id: dir_id.to_string(),
        path: path.clone(),
        name: dir_name,
        is_dir: true,
        size_bytes: 0,
        mime_type: Some("inode/directory".to_string()),
        created_at: ts.clone(),
        updated_at: ts,
    }))
}
