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
use axum::http::header::{
    ACCEPT_RANGES, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, RANGE,
};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{Json, Response};
use axum::{body::Body, extract::Query, extract::State};
use chrono::Utc;
use futures_util::StreamExt;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use sqlx::FromRow;
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use crate::db::{storage_fs, AppState};
use crate::handlers::{
    auth::{ErrorResponse, require_session},
    ws::WsPush,
};
use crate::models::{
    BatchItemResult, BatchOperation, BatchRequest, BatchResponse, FileError, FileInfo, fmt_ts,
    guess_mime, sanitize_path, split_parent,
};

type ApiError = (StatusCode, Json<ErrorResponse>);

fn file_error(err: FileError) -> ApiError {
    let status = match err.code.as_str() {
        "FILE_NOT_FOUND" | "IO_NOT_FOUND" => StatusCode::NOT_FOUND,
        "PATH_EXISTS" => StatusCode::CONFLICT,
        "INVALID_PATH" => StatusCode::BAD_REQUEST,
        "IS_DIRECTORY" | "NOT_A_DIRECTORY" | "SHARE_DIRECTORY_NOT_SUPPORTED" => {
            StatusCode::UNPROCESSABLE_ENTITY
        }
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

pub(crate) fn from_file_error(err: FileError) -> ApiError {
    file_error(err)
}

pub(crate) async fn require_username(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<String, ApiError> {
    require_session(state, headers)
        .await
        .map(|(claims, _)| claims.sub)
}

/// Корень директории пользователя на диске: storage/<username>/
pub(crate) fn user_root(username: &str) -> PathBuf {
    let safe: String = username
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    storage_fs::storage_root().join(safe)
}

/// Builds a user-storage path only from a previously validated relative path.
/// Symlinks are not supported in Loza storage: following one could escape the
/// user's root even when the textual path itself is valid.
pub(crate) async fn storage_path(username: &str, path: &str) -> Result<PathBuf, ApiError> {
    let root = user_root(username);
    let candidate = root.join(path);
    if !candidate.starts_with(&root) {
        return Err(file_error(FileError::invalid_path(path)));
    }

    let mut current = root.clone();
    for component in Path::new(path).components() {
        current.push(component);
        match tokio::fs::symlink_metadata(&current).await {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(file_error(FileError::invalid_path(path)));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(file_error(FileError::from(error))),
        }
    }
    Ok(candidate)
}

/// Materializes metadata for all parent directories. This keeps the database
/// tree authoritative even when a first operation is an upload into a category
/// that has not yet been listed by the client.
async fn ensure_parent_directories(
    state: &AppState,
    username: &str,
    path: &str,
) -> Result<(), ApiError> {
    let Some((parent, _)) = split_parent(path) else { return Ok(()); };
    if parent.is_empty() { return Ok(()); }

    let now = Utc::now().timestamp();
    let mut prefix = String::new();
    for segment in parent.split('/') {
        prefix = if prefix.is_empty() { segment.to_string() } else { format!("{prefix}/{segment}") };
        sqlx::query(
            r#"INSERT INTO user_files (id, username, path, name, is_dir, size_bytes, mime_type, sha256_hex, created_at, updated_at)
               VALUES ($1, $2, $3, $4, true, 0, $5, NULL, $6, $6)
               ON CONFLICT (username, path) DO NOTHING"#,
        )
        .bind(Uuid::new_v4())
        .bind(username)
        .bind(&prefix)
        .bind(segment)
        .bind(Some("inode/directory".to_string()))
        .bind(now)
        .execute(&state.pool)
        .await
        .map_err(FileError::from)
        .map_err(file_error)?;
    }
    Ok(())
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
    sha256_hex: Option<String>,
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
            sha256: row.sha256_hex,
        }
    }
}

#[derive(Debug, FromRow)]
struct FileMetaRow {
    #[allow(dead_code)]
    path: String,
    name: String,
    mime_type: Option<String>,
    #[allow(dead_code)]
    size_bytes: i64,
    sha256_hex: Option<String>,
}

// ─── Query params ─────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    #[serde(default)]
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: String,
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
            r#"SELECT fr.id::text, fr.path, fr.name, fr.is_dir,
                   CASE WHEN fr.is_dir THEN COUNT(child.path) ELSE fr.size_bytes END AS size_bytes,
                   fr.mime_type, fr.created_at, fr.updated_at, fr.sha256_hex
               FROM user_files fr
               LEFT JOIN user_files child ON child.username = fr.username
                 AND child.path LIKE fr.path || '/%'
                 AND child.path NOT LIKE fr.path || '/%/%'
               WHERE fr.username = $1
                 AND fr.path NOT LIKE $2
               GROUP BY fr.id, fr.path, fr.name, fr.is_dir, fr.size_bytes, fr.mime_type, fr.created_at, fr.updated_at, fr.sha256_hex
               ORDER BY (CASE WHEN fr.is_dir THEN 0 ELSE 1 END), fr.name"#,
        )
        .bind(&username)
        .bind("%/%")
        .fetch_all(&state.pool)
        .await
        .map_err(FileError::from)
        .map_err(file_error)?
    } else {
        sqlx::query_as(
            r#"SELECT fr.id::text, fr.path, fr.name, fr.is_dir,
                   CASE WHEN fr.is_dir THEN COUNT(child.path) ELSE fr.size_bytes END AS size_bytes,
                   fr.mime_type, fr.created_at, fr.updated_at, fr.sha256_hex
               FROM user_files fr
               LEFT JOIN user_files child ON child.username = fr.username
                 AND child.path LIKE fr.path || '/%'
                 AND child.path NOT LIKE fr.path || '/%/%'
               WHERE fr.username = $1
                 AND fr.path LIKE $2
                 AND fr.path NOT LIKE $3
               GROUP BY fr.id, fr.path, fr.name, fr.is_dir, fr.size_bytes, fr.mime_type, fr.created_at, fr.updated_at, fr.sha256_hex
               ORDER BY (CASE WHEN fr.is_dir THEN 0 ELSE 1 END), fr.name"#,
        )
        .bind(&username)
        .bind(format!("{dir_prefix}%"))
        .bind(format!("{dir_prefix}%/%"))
        .fetch_all(&state.pool)
        .await
        .map_err(FileError::from)
        .map_err(file_error)?
    };

    Ok(Json(rows.into_iter().map(FileInfo::from).collect()))
}

/// GET /files/search?q=<query>&path=<optional dir>
pub async fn search_files(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<SearchQuery>,
) -> Result<Json<Vec<FileInfo>>, ApiError> {
    let username = require_username(&state, &headers).await?;
    let q = query.q;

    let dir_prefix = if query.path.is_empty() {
        String::new()
    } else {
        let sanitized = sanitize_path(&query.path).map_err(from_file_error)?;
        if sanitized.ends_with('/') {
            sanitized
        } else {
            format!("{sanitized}/")
        }
    };

    let pattern = format!("{dir_prefix}%");

    let rows: Vec<FileRow> = sqlx::query_as(
        r#"SELECT id::text, path, name, is_dir, size_bytes, mime_type, created_at, updated_at, sha256_hex
           FROM user_files
           WHERE username = $1
             AND path LIKE $2
             AND name ILIKE $3
           ORDER BY (CASE WHEN is_dir THEN 0 ELSE 1 END), name"#,
    )
    .bind(&username)
    .bind(&pattern)
    .bind(format!("%{}%", q))
    .fetch_all(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(file_error)?;

    Ok(Json(rows.into_iter().map(FileInfo::from).collect()))
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
        r#"SELECT id::text, path, name, is_dir, size_bytes, mime_type, created_at, updated_at, sha256_hex
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
/// Multipart: поле `file` (файл), поле `path` (директория назначения, опционально),
/// поле `overwrite` (boolean, опционально).
///
/// Безопасность и атомарность:
/// - Каждый файл пишется во временный файл `.«имя».«uuid».loza-part` в той же
///   директории, досинхронизируется на диск и затем атомарно переименовывается
///   в целевой путь. Если в процессе записи что-то падает — временный файл
///   удаляется, а прежний файл (если был) остаётся нетронутым.
/// - Имя файла не может содержать `/` или `\` — это отдельный элемент пути,
///   а не вложенная структура.
/// - MIME предпочитается серверный (по расширению), а не присланный клиентом.
/// - Контент хэшируется SHA-256, чексумма сохраняется в БД.
/// - При overwrite запись выполняется UPSERT с сохранением id файла — share-
///   ссылки на файл продолжают указывать на ту же логическую запись.
pub async fn upload_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<FileInfo>, ApiError> {
    let username = require_username(&state, &headers).await?;
    let _ = sanitize_path(&username).map_err(from_file_error)?;

    let mut dest_dir = String::new();
    let mut overwrite = false;
    let mut saw_file_field = false;
    let mut result: Option<FileInfo> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| file_error(FileError::new("PARSE_ERROR", &format!("Multipart error: {e}"))))?
    {
        let field_name = field.name().map(|n| n.to_string()).unwrap_or_default();

        if field_name == "path" {
            if saw_file_field {
                return Err(file_error(FileError::new(
                    "FIELD_ORDER",
                    "Multipart field `path` must come before the file field",
                )));
            }
            dest_dir = field.text().await.unwrap_or_default();
            continue;
        }

        if field_name == "overwrite" {
            overwrite = field.text().await.unwrap_or_default() == "true";
            continue;
        }

        // A field is a real file upload only when it carries a file name.
        // Any other non-file text field (future client extensions, unknown
        // query fields from proxies…) must be ignored — otherwise it would be
        // stored as an empty random-named file.
        if field.file_name().is_none() {
            continue;
        }

        // file field
        saw_file_field = true;
        let fname = field
            .file_name()
            .map(|f| f.to_string())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        if fname.is_empty()
            || fname == "."
            || fname == ".."
            || fname.contains('/')
            || fname.contains('\\')
        {
            return Err(file_error(FileError::invalid_path(&fname)));
        }
        let client_ct = field.content_type().map(|c| c.to_string());

        let dest = if dest_dir.is_empty() {
            String::new()
        } else {
            sanitize_path(&dest_dir).map_err(from_file_error)?
        };
        let full_path = if dest.is_empty() {
            fname.clone()
        } else {
            format!("{dest}/{fname}")
        };
        let clean_path = sanitize_path(&full_path).map_err(from_file_error)?;

        let disk_path = storage_path(&username, &clean_path).await?;

        // Only a file may own the target name. A directory occupying the path
        // is a conflict even with overwrite=true.
        if let Ok(meta) = tokio::fs::symlink_metadata(&disk_path).await {
            if meta.is_dir() || !overwrite {
                return Err(file_error(FileError::conflict(&clean_path)));
            }
        }

        ensure_parent_directories(&state, &username, &clean_path).await?;
        if let Some(parent) = disk_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(FileError::from)
                .map_err(file_error)?;
        }

        // Write to a temp sibling first, then rename onto the final path.
        // Любая ошибка во время стриминга (в т.ч. оборванный клиентом upload)
        // удаляет temp-файл сразу — сервер не оставляет мусорных `.loza-part`.
        let temp_name = format!(".{fname}.{}.loza-part", Uuid::new_v4());
        let temp_path = disk_path.with_file_name(&temp_name);

        let (total_size, checksum) = {
            let mut temp_file = tokio::fs::File::create(&temp_path)
                .await
                .map_err(FileError::from)
                .map_err(file_error)?;
            let mut hasher = Sha256::new();

            let write_result: Result<(u64, String), FileError> = async {
                let mut total_size: u64 = 0;
                let mut stream = field;
                while let Some(chunk) = stream.next().await {
                    let chunk = chunk
                        .map_err(|e| FileError::new("STREAM_ERROR", &format!("Read error: {e}")))?;
                    if !chunk.is_empty() {
                        total_size += chunk.len() as u64;
                        hasher.update(&chunk);
                        temp_file.write_all(&chunk).await?;
                    }
                }
                temp_file.flush().await?;
                temp_file.sync_all().await?;
                Ok((total_size, format!("{:x}", hasher.finalize())))
            }
            .await;

            match write_result {
                Ok(value) => value,
                Err(err) => {
                    drop(temp_file);
                    let _ = tokio::fs::remove_file(&temp_path).await;
                    return Err(file_error(err));
                }
            }
        };

        // Atomic replace of the final path (rename() replaces the target on
        // both POSIX and Windows; a directory occupying the name fails).
        if let Err(error) = tokio::fs::rename(&temp_path, &disk_path).await {
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Err(match error.kind() {
                std::io::ErrorKind::AlreadyExists | std::io::ErrorKind::PermissionDenied => {
                    file_error(FileError::conflict(&clean_path))
                }
                _ => file_error(FileError::from(error)),
            });
        }

        // MIME: server's guess from the filename wins over the client-supplied
        // content type, which the client could send as anything.
        let mime = match guess_mime(&fname) {
            Some(server) => Some(server.to_string()),
            None => client_ct,
        };
        let dir_name = split_parent(&clean_path)
            .map(|(_, n)| n.to_string())
            .unwrap_or_else(|| fname.to_string());
        let now = Utc::now().timestamp();

        // UPSERT preserving the existing id: share links keep pointing at the
        // same logical file, and created_at stays the original creation time.
        let (file_id, orig_created_at): (String, i64) = sqlx::query_as(
            r#"INSERT INTO user_files (id, username, path, name, is_dir, size_bytes, mime_type, sha256_hex, created_at, updated_at)
               VALUES ($1, $2, $3, $4, false, $5, $6, $7, $8, $9)
               ON CONFLICT (username, path) DO UPDATE
                 SET name = EXCLUDED.name, size_bytes = EXCLUDED.size_bytes,
                     mime_type = EXCLUDED.mime_type, sha256_hex = EXCLUDED.sha256_hex,
                     updated_at = EXCLUDED.updated_at
               RETURNING id::text, created_at"#,
        )
        .bind(Uuid::new_v4())
        .bind(&username)
        .bind(&clean_path)
        .bind(&dir_name)
        .bind(total_size as i64)
        .bind(mime.clone())
        .bind(&checksum)
        .bind(now)
        .bind(now)
        .fetch_one(&state.pool)
        .await
        .map_err(|error| {
            // The file is already in place; if the DB write fails, roll it back
            // so we never hold a file with no metadata. Any leftover is removed
            // by the startup reconciliation.
            let _ = tokio::fs::remove_file(&disk_path);
            file_error(FileError::from(error))
        })?;

        let file_info = FileInfo {
            id: file_id,
            path: clean_path.clone(),
            name: dir_name,
            is_dir: false,
            size_bytes: total_size,
            mime_type: mime,
            created_at: fmt_ts(orig_created_at),
            updated_at: fmt_ts(now),
            sha256: Some(checksum),
        };
        // Broadcast file change via WebSocket for each uploaded file
        state.broadcast_push(&username, serde_json::json!(WsPush::file_created(file_info.clone())));
        result = Some(file_info);
    }

    match result {
        Some(info) => Ok(Json(info)),
        None => Err(file_error(FileError::new(
            "PARSE_ERROR",
            "No file field found in multipart upload",
        ))),
    }
}

// ─── Serving files (download / view / share) ──────────────────────────────

pub(crate) enum Disposition {
    Inline,
    Attachment,
}

/// Единый стриминг-сервинг файла. Content-Length берётся с диска (а не из БД),
/// Range применяется к фактическому размеру, в отдельных header'ах отдаётся
/// X-Checksum-Sha256. Не экспонирует никакие внутренние пути наружу.
pub(crate) async fn serve_file(
    state: &AppState,
    headers: &HeaderMap,
    username: &str,
    path: &str,
    disposition: Disposition,
    checksum_override: Option<String>,
) -> Result<Response, ApiError> {
    let row: FileMetaRow = sqlx::query_as(
        r#"SELECT path, name, mime_type, size_bytes, sha256_hex FROM user_files
           WHERE username = $1 AND path = $2 AND is_dir = false"#,
    )
    .bind(username)
    .bind(path)
    .fetch_optional(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(file_error)?
    .ok_or_else(|| file_error(FileError::not_found(path)))?;

    let name = row.name;
    let checksum = checksum_override.or(row.sha256_hex);
    // Предпочитаем серверный (по расширению) тип: он же не позволяет клиенту
    // подменить тип так, чтобы браузер исполнил inline-контент как HTML.
    let content_type = guess_mime(&name)
        .map(|s| s.to_string())
        .or(row.mime_type)
        .unwrap_or_else(|| "application/octet-stream".to_string());

    let disk_path = storage_path(username, path).await?;
    let file = tokio::fs::File::open(&disk_path)
        .await
        .map_err(FileError::from)
        .map_err(file_error)?;
    let length = file
        .metadata()
        .await
        .map_err(FileError::from)
        .map_err(file_error)?
        .len();

    let disposition_value = match disposition {
        Disposition::Inline => "inline",
        Disposition::Attachment => "attachment",
    };
    let content_disposition = format!(
        "{disposition_value}; filename=\"{}\"; filename*=UTF-8''{}",
        name,
        percent_encode(&name)
    );

    let range = headers
        .get(RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|r| parse_range(r, length));

    let mut response = match range {
        Some(ParsedRange::Unsatisfiable) => {
            let mut resp = Response::new(Body::empty());
            *resp.status_mut() = StatusCode::RANGE_NOT_SATISFIABLE;
            resp.headers_mut().insert(
                CONTENT_RANGE,
                HeaderValue::from_str(&format!("bytes */{length}"))
                    .unwrap_or(HeaderValue::from_static("bytes */0")),
            );
            resp.headers_mut()
                .insert(CONTENT_LENGTH, HeaderValue::from_static("0"));
            resp
        }
        Some(ParsedRange::Partial(start, end)) => {
            use tokio::io::{AsyncReadExt, AsyncSeekExt};
            let mut file = file;
            file.seek(std::io::SeekFrom::Start(start))
                .await
                .map_err(FileError::from)
                .map_err(file_error)?;
            let len = end - start + 1;
            let stream = ReaderStream::with_capacity(file.take(len), 64 * 1024);
            let mut resp = Response::new(Body::from_stream(stream));
            *resp.status_mut() = StatusCode::PARTIAL_CONTENT;
            resp.headers_mut().insert(
                CONTENT_RANGE,
                HeaderValue::from_str(&format!("bytes {start}-{end}/{length}"))
                    .unwrap_or(HeaderValue::from_static("")),
            );
            resp.headers_mut().insert(
                CONTENT_LENGTH,
                HeaderValue::from_str(&len.to_string()).unwrap_or(HeaderValue::from_static("0")),
            );
            resp
        }
        Some(ParsedRange::Full) | None => {
            let stream = ReaderStream::new(file);
            let mut resp = Response::new(Body::from_stream(stream));
            resp.headers_mut().insert(
                CONTENT_LENGTH,
                HeaderValue::from_str(&length.to_string()).unwrap_or(HeaderValue::from_static("0")),
            );
            resp
        }
    };

    let headers_mut = response.headers_mut();
    headers_mut.insert(
        CONTENT_TYPE,
        HeaderValue::from_str(&content_type)
            .unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    headers_mut.insert(ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    headers_mut.insert(
        CONTENT_DISPOSITION,
        HeaderValue::from_str(&content_disposition)
            .unwrap_or_else(|_| HeaderValue::from_static(disposition_value)),
    );
    if let Some(sha) = checksum {
        headers_mut.insert(
            "x-checksum-sha256",
            HeaderValue::from_str(&sha).unwrap_or(HeaderValue::from_static("")),
        );
    }

    Ok(response)
}

enum ParsedRange {
    Full,
    Partial(u64, u64),
    Unsatisfiable,
}

fn parse_range(range_header: &str, total_size: u64) -> ParsedRange {
    if total_size == 0 || !range_header.starts_with("bytes=") {
        return ParsedRange::Full;
    }
    let spec = range_header["bytes=".len()..].trim();
    if spec == "*" {
        return ParsedRange::Unsatisfiable;
    }
    let Some((start_str, end_str)) = spec.split_once('-') else {
        return ParsedRange::Full;
    };
    let Ok(start) = start_str.trim().parse::<u64>() else {
        return ParsedRange::Full;
    };
    if start >= total_size {
        return ParsedRange::Unsatisfiable;
    }
    let end = if end_str.trim().is_empty() {
        total_size - 1
    } else {
        match end_str.trim().parse::<u64>() {
            Ok(end) => end.min(total_size - 1),
            Err(_) => return ParsedRange::Full,
        }
    };
    if start > end {
        return ParsedRange::Full;
    }
    ParsedRange::Partial(start, end)
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

/// GET /files/download?path=<path>
/// Скачивание с поддержкой HTTP Range.
pub async fn download_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<FileQuery>,
) -> Result<Response, ApiError> {
    let username = require_username(&state, &headers).await?;
    let path = sanitize_path(&query.path).map_err(from_file_error)?;
    serve_file(&state, &headers, &username, &path, Disposition::Attachment, None).await
}

/// GET /files/view?path=<path>
/// Просмотр файла (inline content) с поддержкой Range для стриминга.
pub async fn view_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<FileQuery>,
) -> Result<Response, ApiError> {
    let username = require_username(&state, &headers).await?;
    let path = sanitize_path(&query.path).map_err(from_file_error)?;
    serve_file(&state, &headers, &username, &path, Disposition::Inline, None).await
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

    let disk_path = storage_path(&username, &path).await?;

    // Сначала диск, потом метаданные: если удаление с диска упало, строка
    // остаётся и в UI файл всё ещё виден, а не «призрак», который 404-ит.
    // Недоделанные половины в любом случае вычищает реконсиляция при старте.
    match tokio::fs::symlink_metadata(&disk_path).await {
        Ok(metadata) if metadata.is_dir() => tokio::fs::remove_dir_all(&disk_path).await,
        Ok(_) => tokio::fs::remove_file(&disk_path).await,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
    .map_err(FileError::from)
    .map_err(file_error)?;

    // Строки файлов каскадно удaлят свои share-ссылки (FK ON DELETE CASCADE).
    sqlx::query(
        r#"DELETE FROM user_files WHERE username = $1 AND (path = $2 OR path LIKE $3)"#,
    )
    .bind(&username)
    .bind(&path)
    .bind(format!("{path}/%"))
    .execute(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(file_error)?;

    // Broadcast file change via WebSocket
    state.broadcast_push(&username, serde_json::json!(WsPush::file_deleted(&path)));

    Ok(StatusCode::NO_CONTENT)
}

fn join_path(parent: &str, name: &str) -> String {
    if parent.is_empty() { name.to_string() } else { format!("{parent}/{name}") }
}

/// Select a free sibling name. This is intentionally resolved on the server,
/// not in React: two clients can paste into the same directory concurrently.
async fn available_destination(
    state: &AppState,
    username: &str,
    destination: &str,
    source: &str,
) -> Result<String, ApiError> {
    let name = source.rsplit('/').next().unwrap_or(source);
    let initial = join_path(destination, name);
    let exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM user_files WHERE username = $1 AND path = $2",
    )
    .bind(username)
    .bind(&initial)
    .fetch_one(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(file_error)?;
    if exists == 0 { return Ok(initial); }

    let (stem, extension) = match name.rfind('.') {
        Some(index) if index > 0 => (&name[..index], &name[index..]),
        _ => (name, ""),
    };
    for index in 2..10_000 {
        let candidate = join_path(destination, &format!("{stem} ({index}){extension}"));
        let exists: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM user_files WHERE username = $1 AND path = $2",
        )
        .bind(username)
        .bind(&candidate)
        .fetch_one(&state.pool)
        .await
        .map_err(FileError::from)
        .map_err(file_error)?;
        if exists == 0 { return Ok(candidate); }
    }
    Err(file_error(FileError::new("PATH_EXISTS", "Could not allocate a unique destination name")))
}

/// POST /files/batch
///
/// Performs a selection mutation on the server and returns an explicit result
/// for every requested path. A failed item never prevents later independent
/// items from running; that is essential for a usable multi-delete/paste UI.
pub async fn batch_files(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<BatchRequest>,
) -> Result<Json<BatchResponse>, ApiError> {
    let username = require_username(&state, &headers).await?;
    if req.paths.is_empty() || req.paths.len() > 1_000 {
        return Err(file_error(FileError::new("INVALID_BATCH", "Select between 1 and 1000 items")));
    }

    let destination = match req.operation {
        BatchOperation::Delete => None,
        BatchOperation::Copy | BatchOperation::Move => {
            let raw = req.destination.unwrap_or_default();
            let path = if raw.is_empty() { String::new() } else { sanitize_path(&raw).map_err(from_file_error)? };
            if !path.is_empty() {
                let is_dir: Option<bool> = sqlx::query_scalar(
                    "SELECT is_dir FROM user_files WHERE username = $1 AND path = $2",
                )
                .bind(&username)
                .bind(&path)
                .fetch_optional(&state.pool)
                .await
                .map_err(FileError::from)
                .map_err(file_error)?;
                if is_dir != Some(true) {
                    return Err(file_error(FileError::not_a_dir(&path)));
                }
            }
            Some(path)
        }
    };

    let mut results = Vec::with_capacity(req.paths.len());
    let mut seen = std::collections::HashSet::new();
    for raw_path in req.paths {
        let path = match sanitize_path(&raw_path) {
            Ok(path) if seen.insert(path.clone()) => path,
            Ok(path) => {
                results.push(BatchItemResult { path, target_path: None, success: false, error: Some("Duplicate selection".to_string()), file: None });
                continue;
            }
            Err(error) => {
                results.push(BatchItemResult { path: raw_path, target_path: None, success: false, error: Some(error.message), file: None });
                continue;
            }
        };

        let operation = req.operation;
        let target = match operation {
            BatchOperation::Delete => None,
            BatchOperation::Copy => Some(available_destination(&state, &username, destination.as_deref().unwrap_or_default(), &path).await?),
            BatchOperation::Move => {
                let dest = destination.as_deref().unwrap_or_default();
                let parent = split_parent(&path).map(|(parent, _)| parent).unwrap_or_default();
                if parent == dest { Some(path.clone()) }
                else { Some(available_destination(&state, &username, dest, &path).await?) }
            }
        };

        let result = match (operation, target.as_deref()) {
            (BatchOperation::Delete, _) => delete_file(State(state.clone()), headers.clone(), Query(FileQuery { path: path.clone() })).await.map(|_| None),
            (BatchOperation::Copy, Some(to)) => copy_file(State(state.clone()), headers.clone(), Json(crate::models::CopyRequest { from: path.clone(), to: to.to_string() })).await.map(|Json(file)| Some(file)),
            (BatchOperation::Move, Some(to)) if to == path => Ok(None),
            (BatchOperation::Move, Some(to)) => move_file(State(state.clone()), headers.clone(), Json(crate::models::MoveRequest { from: path.clone(), to: to.to_string() })).await.map(|Json(file)| Some(file)),
            _ => unreachable!(),
        };
        match result {
            Ok(file) => results.push(BatchItemResult { path, target_path: target, success: true, error: None, file }),
            Err((_, Json(error))) => results.push(BatchItemResult { path, target_path: target, success: false, error: Some(format!("{}: {}", error.code, error.error)), file: None }),
        }
    }
    Ok(Json(BatchResponse { operation: req.operation, results }))
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
    if from == to || to.starts_with(&(from.clone() + "/")) {
        return Err(file_error(FileError::invalid_path(&to)));
    }

    let row: Option<(String, String, bool, i64, Option<String>, i64, Option<String>)> = sqlx::query_as(
        r#"SELECT id::text, name, is_dir, size_bytes, mime_type, created_at, sha256_hex FROM user_files
           WHERE username = $1 AND path = $2"#,
    )
    .bind(&username)
    .bind(&from)
    .fetch_optional(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(file_error)?;

    let (id, _name, is_dir, size, mime, original_created_at, sha256) =
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

    let disk_from = storage_path(&username, &from).await?;
    let disk_to = storage_path(&username, &to).await?;

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

    ensure_parent_directories(&state, &username, &to).await?;

    // Update the node and its descendants. The old version updated only
    // descendants, leaving the renamed directory missing from listings.
    let now = Utc::now().timestamp();
    let old_prefix = format!("{from}/");
    let new_prefix = format!("{to}/");
    let new_name = split_parent(&to)
        .map(|(_, n)| n.to_string())
        .unwrap_or_else(|| to.clone());

    sqlx::query(
        r#"UPDATE user_files
           SET path = CASE WHEN path = $1 THEN $2 ELSE $3 || SUBSTRING(path FROM CHAR_LENGTH($4) + 1) END,
               name = CASE WHEN path = $1 THEN $5 ELSE name END,
               updated_at = $6
           WHERE username = $7 AND (path = $1 OR path LIKE $8)"#,
    )
    .bind(&from)
    .bind(&to)
    .bind(&new_prefix)
    .bind(&old_prefix)
    .bind(&new_name)
    .bind(now)
    .bind(&username)
    .bind(format!("{from}/%"))
    .execute(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(file_error)?;

    let result = FileInfo {
        id,
        path: to.clone(),
        name: new_name,
        is_dir,
        size_bytes: size.max(0) as u64,
        mime_type: mime,
        created_at: fmt_ts(original_created_at),
        updated_at: fmt_ts(now),
        sha256,
    };

    // Broadcast file change via WebSocket
    state.broadcast_push(&username, serde_json::json!(WsPush::file_renamed(&from, to.clone(), is_dir, result.clone())));

    Ok(Json(result))
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
    if from == to || to.starts_with(&(from.clone() + "/")) {
        return Err(file_error(FileError::invalid_path(&to)));
    }

    let row: Option<(String, bool, i64, Option<String>, Option<String>)> = sqlx::query_as(
        r#"SELECT name, is_dir, size_bytes, mime_type, sha256_hex FROM user_files
           WHERE username = $1 AND path = $2"#,
    )
    .bind(&username)
    .bind(&from)
    .fetch_optional(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(file_error)?;

    let (_name, is_dir, size, mime, sha256) =
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

    let disk_from = storage_path(&username, &from).await?;
    let disk_to = storage_path(&username, &to).await?;

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

    // Try to create the destination row first: the unique index on (username, path)
    // is the real arbiter of conflicts. The COUNT() check above is only a fast-path
    // error; without this INSERT a concurrent copy to the same destination would
    // race past the check, copy over the disk file, and then hard-fail (or worse,
    // leave an orphan on disk).
    let inserted: u64 = if is_dir {
        sqlx::query(
            r#"INSERT INTO user_files (id, username, path, name, is_dir, size_bytes, mime_type, sha256_hex, created_at, updated_at)
               VALUES (gen_random_uuid(), $1, $2, $3, true, 0, $4, NULL, $5, $5)
               ON CONFLICT (username, path) DO NOTHING"#,
        )
        .bind(&username)
        .bind(&to)
        .bind(split_parent(&to).map(|(_, item_name)| item_name).unwrap_or(&to))
        .bind(Some("inode/directory".to_string()))
        .bind(now)
        .execute(&state.pool)
        .await
        .map_err(FileError::from)
        .map_err(file_error)?
        .rows_affected()
    } else {
        let destination_name = split_parent(&to)
            .map(|(_, item_name)| item_name.to_string())
            .unwrap_or_else(|| to.clone());
        sqlx::query(
            r#"INSERT INTO user_files (id, username, path, name, is_dir, size_bytes, mime_type, sha256_hex, created_at, updated_at)
               VALUES (gen_random_uuid(), $1, $2, $3, false, $4, $5, $6, $7, $7)
               ON CONFLICT (username, path) DO NOTHING"#,
        )
        .bind(&username)
        .bind(&to)
        .bind(&destination_name)
        .bind(size)
        .bind(mime.clone())
        .bind(&sha256)
        .bind(now)
        .execute(&state.pool)
        .await
        .map_err(FileError::from)
        .map_err(file_error)?
        .rows_affected()
    };

    if inserted == 0 {
        // Another request won the race — roll back the disk copy we just made.
        if is_dir {
            tokio::fs::remove_dir_all(&disk_to).await.ok();
        } else {
            tokio::fs::remove_file(&disk_to).await.ok();
        }
        return Err(file_error(FileError::conflict(&to)));
    }

    // Copy the directory children into fresh rows under the new path.
    if is_dir {
        sqlx::query(
            r#"INSERT INTO user_files (id, username, path, name, is_dir, size_bytes, mime_type, sha256_hex, created_at, updated_at)
               SELECT gen_random_uuid(), $1,
                      $2 || SUBSTRING(path FROM CHAR_LENGTH($3) + 1),
                      name, is_dir, size_bytes, mime_type, sha256_hex, $4, $4
               FROM user_files
               WHERE username = $1 AND path LIKE $3
               ON CONFLICT (username, path) DO NOTHING"#,
        )
        .bind(&username)
        .bind(format!("{to}/"))
        .bind(format!("{from}/"))
        .bind(now)
        .execute(&state.pool)
        .await
        .map_err(FileError::from)
        .map_err(file_error)?;
    }

    ensure_parent_directories(&state, &username, &to).await?;

    let destination_name = split_parent(&to)
        .map(|(_, item_name)| item_name.to_string())
        .unwrap_or_else(|| to.clone());
    let result_id: String = sqlx::query_scalar(
        r#"SELECT id::text FROM user_files WHERE username = $1 AND path = $2"#,
    )
    .bind(&username)
    .bind(&to)
    .fetch_one(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(file_error)?;
    let now_str = fmt_ts(now);
    let result = FileInfo {
        id: result_id,
        path: to.clone(),
        name: destination_name,
        is_dir,
        size_bytes: size.max(0) as u64,
        mime_type: mime,
        created_at: now_str.clone(),
        updated_at: now_str,
        sha256,
    };

    // Broadcast file change via WebSocket
    state.broadcast_push(&username, serde_json::json!(WsPush::file_created(result.clone())));

    Ok(Json(result))
}

async fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    tokio::fs::create_dir_all(dst).await?;
    let mut entries = tokio::fs::read_dir(src).await?;
    while let Some(entry) = entries.next_entry().await? {
        let entry_path = entry.path();
        let dest_path = dst.join(entry.file_name());
        let file_type = entry.file_type().await?;
        if file_type.is_symlink() {
            // Symlinks are not supported in Loza storage — skip rather than
            // following them, which could escape the user's storage root.
            continue;
        } else if file_type.is_dir() {
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

    let disk_path = storage_path(&username, &path).await?;
    ensure_parent_directories(&state, &username, &path).await?;
    tokio::fs::create_dir_all(&disk_path)
        .await
        .map_err(FileError::from)
        .map_err(file_error)?;

    let dir_id = Uuid::new_v4();
    let now = Utc::now().timestamp();
    sqlx::query(
        r#"INSERT INTO user_files (id, username, path, name, is_dir, size_bytes, mime_type, sha256_hex, created_at, updated_at)
           VALUES ($1, $2, $3, $4, true, 0, $5, NULL, $6, $7)"#,
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
    let result = FileInfo {
        id: dir_id.to_string(),
        path: path.clone(),
        name: dir_name,
        is_dir: true,
        size_bytes: 0,
        mime_type: Some("inode/directory".to_string()),
        created_at: ts.clone(),
        updated_at: ts,
        sha256: None,
    };

    // Broadcast file change via WebSocket
    state.broadcast_push(&username, serde_json::json!(WsPush::file_created(result.clone())));

    Ok(Json(result))
}

#[cfg(test)]
mod tests {
    use super::{ParsedRange, parse_range};

    #[test]
    fn rejects_invalid_or_empty_ranges() {
        assert!(matches!(parse_range("bytes=0-", 0), ParsedRange::Full));
        assert!(matches!(parse_range("bytes=9-2", 10), ParsedRange::Full));
        assert!(matches!(parse_range("bytes=1", 10), ParsedRange::Full));
        assert!(matches!(parse_range("chunked", 10), ParsedRange::Full));
    }

    #[test]
    fn rejects_unsatisfiable_ranges_with_416() {
        assert!(matches!(parse_range("bytes=100-", 100), ParsedRange::Unsatisfiable));
        assert!(matches!(parse_range("bytes=20-30", 10), ParsedRange::Unsatisfiable));
        assert!(matches!(parse_range("bytes=*", 100), ParsedRange::Unsatisfiable));
    }

    #[test]
    fn clamps_open_ended_ranges() {
        assert!(matches!(parse_range("bytes=5-", 10), ParsedRange::Partial(5, 9)));
    }

    #[test]
    fn clamps_overshooting_end() {
        assert!(matches!(parse_range("bytes=0-999", 100), ParsedRange::Partial(0, 99)));

        assert!(matches!(parse_range("bytes=2-7", 10), ParsedRange::Partial(2, 7)));
    }
}