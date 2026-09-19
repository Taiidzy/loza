//! Публичные share-ссылки на файлы.
//!
//! Модель безопасности:
//! - Токен = 256 бит энтропии (hex SHA-256 от 32 случайных байт). Подобрать
//!   его невозможно, поэтому отдельная авторизация на публичных эндпоинтах
//!   не нужна.
//! - Ссылка привязана к файлу по id: переименование/перемещение не ломает её,
//!   а удаление файла каскадно отзывает (FK ON DELETE CASCADE).
//! - Публичные ответы не содержат ни пути файла, ни имени владельца: `/share/:token`
//!   отдаёт само тело файла inline (браузер показывает картинку/PDF/текст),
//!   `/share/:token/download` — с принудительным скачиванием.
//! - expire/revoke делают ссылку бесполезной немедленно (проверка
//!   `is_active` и `expires_at` при каждом обращении).

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{Json, Response};
use chrono::Utc;
use rand_core::{OsRng, RngCore};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::db::AppState;
use crate::handlers::auth::ErrorResponse;
use crate::handlers::files::{self, Disposition, from_file_error, require_username};
use crate::models::{CreateShareRequest, FileError, ShareInfo, fmt_ts, sanitize_path};

type ApiError = (StatusCode, Json<ErrorResponse>);

/// 256 бит энтропии, hex-кодированные (64 символа). Коллизия с другим токеном
/// практически исключена; UNIQUE индекс в БД — последняя линия защиты.
fn new_share_token() -> String {
    let mut buf = [0u8; 32];
    OsRng.fill_bytes(&mut buf);
    format!("{:x}", Sha256::digest(&buf))
}

#[derive(Debug, Deserialize)]
pub struct ShareQuery {
    pub token: String,
}

#[derive(Debug, Deserialize)]
pub struct ShareListQuery {
    #[serde(default)]
    pub path: String,
}

/// POST /files/share  {"path": "<file_path>"}  (auth)
pub async fn create_share(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateShareRequest>,
) -> Result<Json<ShareInfo>, ApiError> {
    let username = require_username(&state, &headers).await?;
    let path = sanitize_path(&req.path).map_err(from_file_error)?;

    let row: Option<(String, bool, i64)> = sqlx::query_as::<_, (String, bool, i64)>(
        r#"SELECT id::text, is_dir, created_at FROM user_files
           WHERE username = $1 AND path = $2"#,
    )
    .bind(&username)
    .bind(&path)
    .fetch_optional(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(from_file_error)?;

    let (file_id, is_dir, _created_at) =
        row.ok_or_else(|| from_file_error(FileError::not_found(&path)))?;
    if is_dir {
        return Err(from_file_error(FileError::new(
            "SHARE_DIRECTORY_NOT_SUPPORTED",
            "Sharing directories is not supported yet",
        )));
    }

    let token = new_share_token();
    let now = Utc::now().timestamp();
    let (share_id,): (String,) = sqlx::query_as::<_, (String,)>(
        r#"INSERT INTO file_shares (id, file_id, username, token, created_at, expires_at, is_active)
           VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4, NULL, true)
           RETURNING id::text"#,
    )
    .bind(&file_id)
    .bind(&username)
    .bind(&token)
    .bind(now)
    .fetch_one(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(from_file_error)?;

    Ok(Json(ShareInfo {
        id: share_id,
        token,
        created_at: fmt_ts(now),
        expires_at: None,
        is_active: true,
    }))
}

/// GET /files/shares?path=<file_path>  (auth)
/// Пустой path возвращает все ссылки пользователя.
pub async fn list_shares(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ShareListQuery>,
) -> Result<Json<Vec<ShareInfo>>, ApiError> {
    let username = require_username(&state, &headers).await?;

    let rows: Vec<(String, String, i64, Option<i64>, bool)> = if query.path.is_empty() {
        sqlx::query_as::<_, (String, String, i64, Option<i64>, bool)>(
            r#"SELECT s.id::text, s.token, s.created_at, s.expires_at, s.is_active
               FROM file_shares s
               WHERE s.username = $1
               ORDER BY s.created_at DESC"#,
        )
        .bind(&username)
        .fetch_all(&state.pool)
        .await
        .map_err(FileError::from)
        .map_err(from_file_error)?
    } else {
        let path = sanitize_path(&query.path).map_err(from_file_error)?;
        sqlx::query_as::<_, (String, String, i64, Option<i64>, bool)>(
            r#"SELECT s.id::text, s.token, s.created_at, s.expires_at, s.is_active
               FROM file_shares s
               JOIN user_files f ON f.id = s.file_id
               WHERE s.username = $1 AND f.path = $2 AND f.is_dir = false
               ORDER BY s.created_at DESC"#,
        )
        .bind(&username)
        .bind(&path)
        .fetch_all(&state.pool)
        .await
        .map_err(FileError::from)
        .map_err(from_file_error)?
    };

    Ok(Json(
        rows.into_iter()
            .map(|(id, token, created_at, expires_at, is_active)| ShareInfo {
                id,
                token,
                created_at: fmt_ts(created_at),
                expires_at: expires_at.map(fmt_ts),
                is_active,
            })
            .collect(),
    ))
}

/// DELETE /files/share/revoke?token=<token>  (auth, owner only)
pub async fn revoke_share(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ShareQuery>,
) -> Result<StatusCode, ApiError> {
    let username = require_username(&state, &headers).await?;
    let token = query.token;
    if token.is_empty() || token.len() > 128 {
        return Err(from_file_error(FileError::new("INVALID_TOKEN", "Invalid share token")));
    }

    let owner: Option<String> = sqlx::query_as::<_, (String,)>(
        "SELECT username FROM file_shares WHERE token = $1",
    )
    .bind(&token)
    .fetch_optional(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(from_file_error)?
    .map(|(username,)| username);

    match owner {
        None => Err(from_file_error(FileError::not_found("share"))),
        Some(owner) if owner != username => Err(from_file_error(FileError::new(
            "SHARE_NOT_OWNER",
            "You are not the owner of this share link",
        ))),
        Some(_) => {
            let removed = sqlx::query(
                "UPDATE file_shares SET is_active = false WHERE token = $1 AND username = $2",
            )
            .bind(&token)
            .bind(&username)
            .execute(&state.pool)
            .await
            .map_err(FileError::from)
            .map_err(from_file_error)?
            .rows_affected();
            if removed == 0 {
                return Err(from_file_error(FileError::not_found("share")));
            }
            Ok(StatusCode::NO_CONTENT)
        }
    }
}

/// GET /share/:token  (public, no auth)
/// Инлайновая отдача самого файла: браузер показывает картинку/PDF/текст
/// прямо по ссылке, а не JSON-метаданные. Путь и владелец наружу не уходят.
/// Range поддерживается, поэтому видео/PDF стримятся.
pub async fn share_view(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(token): Path<String>,
) -> Result<Response, ApiError> {
    let now = Utc::now().timestamp();
    let row: Option<(String, String, Option<String>)> = sqlx::query_as::<_, (String, String, Option<String>)>(
        r#"SELECT f.username, f.path, f.sha256_hex
           FROM file_shares s
           JOIN user_files f ON f.id = s.file_id
           WHERE s.token = $1 AND s.is_active
             AND (s.expires_at IS NULL OR s.expires_at > $2)"#,
    )
    .bind(&token)
    .bind(now)
    .fetch_optional(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(from_file_error)?;

    let (username, path, sha256) =
        row.ok_or_else(|| from_file_error(FileError::not_found("share")))?;

    files::serve_file(&state, &headers, &username, &path, Disposition::Inline, sha256).await
}

/// GET /share/:token/download  (public, no auth)
/// Потоковая отдача файла с поддержкой Range. Путь файла наружу не уходит.
pub async fn share_download(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(token): Path<String>,
) -> Result<axum::response::Response, ApiError> {
    let now = Utc::now().timestamp();
    let row: Option<(String, String, Option<String>)> = sqlx::query_as::<_, (String, String, Option<String>)>(
        r#"SELECT f.username, f.path, f.sha256_hex
           FROM file_shares s
           JOIN user_files f ON f.id = s.file_id
           WHERE s.token = $1 AND s.is_active
             AND (s.expires_at IS NULL OR s.expires_at > $2)"#,
    )
    .bind(&token)
    .bind(now)
    .fetch_optional(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(from_file_error)?;

    let (username, path, sha256) =
        row.ok_or_else(|| from_file_error(FileError::not_found("share")))?;

    files::serve_file(&state, &headers, &username, &path, Disposition::Attachment, sha256).await
}