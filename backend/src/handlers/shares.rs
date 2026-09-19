//! Публичные share-ссылки на файлы и директории.
//!
//! Модель безопасности:
//! - Токен = 256 бит энтропии (hex SHA-256 от 32 случайных байт). Подобрать
//!   его невозможно, поэтому отдельная авторизация на публичных эндпоинтах
//!   держится не на знаниях, а на «что-то, что есть у получателя»:
//!   ссылка может быть защищена паролем (argon2id-хеш в БД).
//! - Ссылка привязана к узлу по id: переименование/перемещение не ломают её,
//!   а удаление каскадно отзывает (FK ON DELETE CASCADE).
//! - Публичные ответы не содержат ни абсолютных путей, ни имени владельца.
//!   Внутри папки путь отдаётся относительно корня ссылки.
//! - После разблокировки (пароль или просто ссылка) клиент получает
//!   stateless HMAC-подписанный access-токен (24 ч). Просмотр/скачивание до
//!   разблокировки невозможен — в т.ч. для ссылок без пароля.
//! - Брутфорс пароля ограничен сеткой неудачных попыток по ip+токен.
//! - expire/revoke делают ссылку бесполезной немедленно.
//! - `/share` без токена не отдаёт никакого списка ссылок (маршрута нет).

use argon2::password_hash::SaltString;
use argon2::{Argon2, PasswordHasher, PasswordVerifier};
use axum::body::Body;
use axum::extract::{ConnectInfo, Path, Query, State};
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{Json, Response};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::Utc;
use hmac::{Hmac, Mac};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::FromRow;
use std::net::SocketAddr;

use crate::db::AppState;
use crate::handlers::auth::ErrorResponse;
use crate::handlers::files::{self, Disposition, from_file_error, require_username};
use crate::models::{CreateShareRequest, FileError, FileInfo, ShareInfo, fmt_ts, sanitize_path};

type ApiError = (StatusCode, Json<ErrorResponse>);
type HmacSha256 = Hmac<Sha256>;

/// Срок жизни access-токена после разблокировки ссылки.
const ACCESS_TTL_SECS: i64 = 24 * 3600;
/// Предел длины пароля ссылки (argon2 работает на любых длинах, но добрый
/// лимит защищает от аномально тяжёлых и аномально длинных паролей).
const MAX_SHARE_PASSWORD_LEN: usize = 128;

// ─── Вспомогательные ошибки ────────────────────────────────────────────────

fn error_response(status: StatusCode, code: &str, message: &str) -> ApiError {
    (
        status,
        Json(ErrorResponse {
            error: message.to_string(),
            code: code.to_string(),
        }),
    )
}

fn unauthorized(message: &str) -> ApiError {
    error_response(StatusCode::UNAUTHORIZED, "UNAUTHORIZED", message)
}

fn share_not_found() -> ApiError {
    from_file_error(FileError::not_found("share"))
}

fn wrong_password() -> ApiError {
    error_response(StatusCode::UNAUTHORIZED, "WRONG_PASSWORD", "Wrong password")
}

/// В legacy-режиме (когда веб-интерфейс не раздаётся) `/share/:token`
/// отдаёт тело файла сразу. Парольная ссылка в этом режиме не должна
/// отдавать содержимое — проверять пароль здесь негде (unlock-API и SPA
/// существуют только в полноценном режиме). Иначе пароль превращается в
/// декорацию, которую можно обойти простым `GET /share/<token>`.
fn legacy_password_guard(row: &ShareRow) -> Result<(), ApiError> {
    if row.password_hash.is_some() {
        return Err(error_response(
            StatusCode::UNAUTHORIZED,
            "SHARE_PASSWORD_REQUIRED",
            "This share link is password-protected",
        ));
    }
    Ok(())
}

fn internal(message: &str) -> ApiError {
    error_response(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", message)
}

// ─── Access-токен (stateless, HMAC) ────────────────────────────────────────

fn base64_url(data: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(data)
}

fn base64_url_decode(data: &str) -> Result<Vec<u8>, String> {
    URL_SAFE_NO_PAD
        .decode(data.as_bytes())
        .map_err(|e| e.to_string())
}

fn sign_hmac(secret: &str, data: &[u8]) -> String {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(secret.as_bytes())
        .expect("HMAC accepts any key length");
    mac.update(data);
    base64_url(&mac.finalize().into_bytes())
}

/// Подписанный access-токен: `base64url({"exp":…,"share":…}) . base64url(hmac)`.
fn sign_access(jwt_secret: &str, share_token: &str, now: i64) -> String {
    let payload = serde_json::json!({ "exp": now + ACCESS_TTL_SECS, "share": share_token });
    let payload_b64 = base64_url(payload.to_string().as_bytes());
    format!("{payload_b64}.{}", sign_hmac(jwt_secret, payload_b64.as_bytes()))
}

/// Проверка подписи, срока действия и привязки к конкретной ссылке.
fn verify_access(
    jwt_secret: &str,
    share_token: &str,
    access: &str,
    now: i64,
) -> Result<(), ApiError> {
    let Some((payload_b64, mac_b64)) = access.split_once('.') else {
        return Err(unauthorized("Missing or malformed access token"));
    };
    let expected_mac =
        base64_url_decode(mac_b64).map_err(|_| unauthorized("Malformed access token"))?;

    let mut mac = <HmacSha256 as Mac>::new_from_slice(jwt_secret.as_bytes())
        .expect("HMAC accepts any key length");
    mac.update(payload_b64.as_bytes());
    if mac.verify_slice(&expected_mac).is_err() {
        return Err(unauthorized("Access token is not valid"));
    }

    let payload_bytes =
        base64_url_decode(payload_b64).map_err(|_| unauthorized("Malformed access token"))?;
    let json: serde_json::Value = serde_json::from_slice(&payload_bytes)
        .map_err(|_| unauthorized("Malformed access token"))?;
    let exp = json.get("exp").and_then(serde_json::Value::as_i64).unwrap_or(0);
    let token = json.get("share").and_then(serde_json::Value::as_str).unwrap_or_default();

    if exp < now || token != share_token {
        return Err(unauthorized("Access token is not valid"));
    }
    Ok(())
}

// ─── Пароли ────────────────────────────────────────────────────────────────

fn hash_password(password: &str) -> Result<String, ApiError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|e| internal(&format!("Failed to hash share password: {e}")))
}

// ─── Общие helper'ы ────────────────────────────────────────────────────────

/// Строка БД для ссылки: узел + защита + файловые метаданные.
/// Абсолютный путь (`path`) — внутренняя деталь: за пределы модуля не выходит.
#[derive(Debug, FromRow)]
struct ShareRow {
    username: String,
    path: String,
    is_dir: bool,
    password_hash: Option<String>,
    is_active: bool,
    created_at: i64,
    expires_at: Option<i64>,
    size_bytes: Option<i64>,
    mime_type: Option<String>,
    sha256_hex: Option<String>,
}

impl ShareRow {
    fn active_at(&self, now: i64) -> bool {
        self.is_active && self.expires_at.map_or(true, |exp| exp > now)
    }

    fn name(&self) -> String {
        self.path.rsplit('/').next().unwrap_or(&self.path).to_string()
    }
}

async fn fetch_share(state: &AppState, token: &str) -> Result<ShareRow, ApiError> {
    if token.is_empty() || token.len() > 128 {
        return Err(share_not_found());
    }
    sqlx::query_as::<_, ShareRow>(
        r#"SELECT f.username, f.path, f.is_dir, s.password_hash, s.is_active,
                  s.created_at, s.expires_at,
                  CASE WHEN f.is_dir THEN NULL ELSE f.size_bytes END,
                  CASE WHEN f.is_dir THEN NULL ELSE f.mime_type END,
                  f.sha256_hex
             FROM file_shares s
             JOIN user_files f ON f.id = s.file_id
             WHERE s.token = $1"#,
    )
    .bind(token)
    .fetch_optional(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(from_file_error)?
    .ok_or_else(share_not_found)
}

/// Путь относительно корня ссылки из абсолютного.
fn rel_of(share_root: &str, full_path: &str) -> String {
    if let Some(rest) = full_path.strip_prefix(share_root)
        && let Some(rel) = rest.strip_prefix('/')
    {
        return rel.to_string();
    }
    full_path.to_string()
}

// ─── Управление ссылками (auth) ────────────────────────────────────────────

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

/// POST /files/share  {"path": "<path>", "password"?: "<optional>"}  (auth)
/// Ссылку можно создать и на файл, и на директорию. Пароль задаётся только
/// при создании; изменить его нельзя (отзыв + пересоздание).
pub async fn create_share(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateShareRequest>,
) -> Result<Json<ShareInfo>, ApiError> {
    let username = require_username(&state, &headers).await?;
    let path = sanitize_path(&req.path).map_err(from_file_error)?;

    let file_id: Option<String> = sqlx::query_scalar(
        "SELECT id::text FROM user_files WHERE username = $1 AND path = $2",
    )
    .bind(&username)
    .bind(&path)
    .fetch_optional(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(from_file_error)?;
    let file_id = file_id.ok_or_else(|| from_file_error(FileError::not_found(&path)))?;

    let password_hash = match req.password {
        Some(ref password) if !password.trim().is_empty() => {
            if password.len() > MAX_SHARE_PASSWORD_LEN {
                return Err(from_file_error(FileError::new(
                    "INVALID_PASSWORD",
                    &format!("Password must be at most {MAX_SHARE_PASSWORD_LEN} characters"),
                )));
            }
            Some(hash_password(password)?)
        }
        _ => None,
    };

    let token = new_share_token();
    let now = Utc::now().timestamp();
    let (share_id,): (String,) = sqlx::query_as::<_, (String,)>(
        r#"INSERT INTO file_shares (id, file_id, username, token, created_at, expires_at, is_active, password_hash)
           VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4, NULL, true, $5)
           RETURNING id::text"#,
    )
    .bind(&file_id)
    .bind(&username)
    .bind(&token)
    .bind(now)
    .bind(&password_hash)
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
        has_password: password_hash.is_some(),
    }))
}

/// GET /files/shares?path=<path>  (auth)
/// Пустой path возвращает все ссылки пользователя.
pub async fn list_shares(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ShareListQuery>,
) -> Result<Json<Vec<ShareInfo>>, ApiError> {
    let username = require_username(&state, &headers).await?;

    let rows: Vec<(String, String, i64, Option<i64>, bool, Option<String>)> =
        if query.path.is_empty() {
            sqlx::query_as::<_, (String, String, i64, Option<i64>, bool, Option<String>)>(
                r#"SELECT s.id::text, s.token, s.created_at, s.expires_at, s.is_active, s.password_hash
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
            sqlx::query_as::<_, (String, String, i64, Option<i64>, bool, Option<String>)>(
                r#"SELECT s.id::text, s.token, s.created_at, s.expires_at, s.is_active, s.password_hash
                   FROM file_shares s
                   JOIN user_files f ON f.id = s.file_id
                   WHERE s.username = $1 AND f.path = $2
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
            .map(|(id, token, created_at, expires_at, is_active, password_hash)| ShareInfo {
                id,
                token,
                created_at: fmt_ts(created_at),
                expires_at: expires_at.map(fmt_ts),
                is_active,
                has_password: password_hash.is_some(),
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
        None => Err(share_not_found()),
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
                return Err(share_not_found());
            }
            Ok(StatusCode::NO_CONTENT)
        }
    }
}

// ─── Публичное API share-viewer-web ────────────────────────────────────────

/// GET /share/api/:token/meta  (public)
/// Безопасный минимум метаданных для экрана разблокировки/шапки просмотра.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareMeta {
    pub name: String,
    pub is_dir: bool,
    pub has_password: bool,
    pub is_active: bool,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub size_bytes: Option<u64>,
    pub mime_type: Option<String>,
    pub sha256: Option<String>,
}

pub async fn share_meta(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Json<ShareMeta>, ApiError> {
    let now = Utc::now().timestamp();
    let row = fetch_share(&state, &token).await?;
    Ok(Json(ShareMeta {
        name: row.name(),
        is_dir: row.is_dir,
        has_password: row.password_hash.is_some(),
        is_active: row.active_at(now),
        created_at: fmt_ts(row.created_at),
        expires_at: row.expires_at.map(fmt_ts),
        size_bytes: row.size_bytes.map(|size| size.max(0) as u64),
        mime_type: row.mime_type,
        sha256: row.sha256_hex,
    }))
}

/// POST /share/api/:token/unlock  {"password": "…"}  (public)
/// Возвращает access-токен. Для ссылок без пароля password может быть любым
/// (в т.ч. пустым) — разблокировка всё равно работает.
#[derive(Debug, Deserialize)]
pub struct UnlockRequest {
    pub password: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockResponse {
    pub access: String,
}

pub async fn share_unlock(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(token): Path<String>,
    Json(req): Json<UnlockRequest>,
) -> Result<Json<UnlockResponse>, ApiError> {
    let now = Utc::now().timestamp();
    let row = fetch_share(&state, &token).await?;
    if !row.active_at(now) {
        return Err(share_not_found());
    }

    let ip = addr.ip();
    if state.is_share_unlock_rate_limited(ip, &token, now as u64) {
        return Err(error_response(
            StatusCode::TOO_MANY_REQUESTS,
            "TOO_MANY_ATTEMPTS",
            "Too many failed unlock attempts. Try again later.",
        ));
    }

    if let Some(hash) = row.password_hash.as_deref() {
        if req.password.len() > MAX_SHARE_PASSWORD_LEN {
            return Err(wrong_password());
        }
        let Ok(parsed) = argon2::PasswordHash::new(hash) else {
            return Err(share_not_found());
        };
        if Argon2::default()
            .verify_password(req.password.as_bytes(), &parsed)
            .is_err()
        {
            state.record_share_unlock_failure(ip, &token, now as u64);
            return Err(wrong_password());
        }
        state.clear_share_unlock_failures(ip, &token);
    }

    Ok(Json(UnlockResponse {
        access: sign_access(&state.config.jwt_secret, &token, now),
    }))
}

/// GET /share/api/:token/list?path=<rel>&access=<token>  (public, access)
/// Листинг директории внутри ссылки. Пути в ответе — относительно корня ссылки.
#[derive(Debug, Deserialize)]
pub struct PublicShareQuery {
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub access: Option<String>,
}

pub async fn share_list(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Query(query): Query<PublicShareQuery>,
) -> Result<Json<Vec<FileInfo>>, ApiError> {
    let now = Utc::now().timestamp();
    let row = fetch_share(&state, &token).await?;
    if !row.active_at(now) {
        return Err(share_not_found());
    }
    let access = query
        .access
        .as_deref()
        .ok_or_else(|| unauthorized("Access token is required"))?;
    verify_access(&state.config.jwt_secret, &token, access, now)?;

    if !row.is_dir {
        return Err(from_file_error(FileError::new(
            "SHARE_IS_NOT_DIRECTORY",
            "This share is a single file",
        )));
    }

    let rel_dir = match query.path.trim_matches('/') {
        "" => String::new(),
        rel => sanitize_path(rel).map_err(from_file_error)?,
    };
    let dir_path = if rel_dir.is_empty() {
        row.path.clone()
    } else {
        format!("{}/{rel_dir}", row.path)
    };
    list_children(&state, &row.username, &row.path, &dir_path).await
}

async fn list_children(
    state: &AppState,
    username: &str,
    share_root: &str,
    dir_path: &str,
) -> Result<Json<Vec<FileInfo>>, ApiError> {
    if !dir_path.starts_with(share_root) {
        return Err(share_not_found());
    }
    let is_dir: Option<bool> = sqlx::query_scalar(
        "SELECT is_dir FROM user_files WHERE username = $1 AND path = $2",
    )
    .bind(username)
    .bind(dir_path)
    .fetch_optional(&state.pool)
    .await
    .map_err(FileError::from)
    .map_err(from_file_error)?;
    if !is_dir.unwrap_or(false) {
        return Err(from_file_error(FileError::not_found(dir_path)));
    }

    let prefix = format!("{dir_path}/");
    let rows: Vec<(String, String, String, bool, i64, Option<String>, i64, i64, Option<String>)> =
        sqlx::query_as::<_, (String, String, String, bool, i64, Option<String>, i64, i64, Option<String>)>(
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
               GROUP BY fr.id, fr.path, fr.name, fr.is_dir, fr.size_bytes, fr.mime_type,
                        fr.created_at, fr.updated_at, fr.sha256_hex
               ORDER BY (CASE WHEN fr.is_dir THEN 0 ELSE 1 END), fr.name"#,
        )
        .bind(username)
        .bind(format!("{prefix}%"))
        .bind(format!("{prefix}%/%"))
        .fetch_all(&state.pool)
        .await
        .map_err(FileError::from)
        .map_err(from_file_error)?;

    Ok(Json(
        rows.into_iter()
            .map(
                |(id, path, name, is_dir, size_bytes, mime_type, created_at, updated_at, sha256)| {
                    FileInfo {
                        id,
                        path: rel_of(share_root, &path),
                        name,
                        is_dir,
                        size_bytes: size_bytes.max(0) as u64,
                        mime_type,
                        created_at: fmt_ts(created_at),
                        updated_at: fmt_ts(updated_at),
                        sha256,
                    }
                },
            )
            .collect(),
    ))
}

/// GET /share/api/:token/download?path=<rel>&access=<token>  (public, access)
/// GET /share/api/:token/preview?path=<rel>&access=<token>  (public, access)
/// Стриминг с Range. Для ссылки-файла `path` пустой; для папки — путь к файлу
/// внутри неё.
async fn serve_share_file(
    state: &AppState,
    headers: HeaderMap,
    token: &str,
    query: PublicShareQuery,
    disposition: Disposition,
) -> Result<Response, ApiError> {
    let now = Utc::now().timestamp();
    let row = fetch_share(state, token).await?;
    if !row.active_at(now) {
        return Err(share_not_found());
    }
    let access = query
        .access
        .as_deref()
        .ok_or_else(|| unauthorized("Access token is required"))?;
    verify_access(&state.config.jwt_secret, token, access, now)?;

    let rel = match query.path.trim_matches('/') {
        "" => String::new(),
        rel => sanitize_path(rel).map_err(from_file_error)?,
    };
    if row.is_dir && rel.is_empty() {
        return Err(from_file_error(FileError::new(
            "SHARE_IS_DIRECTORY",
            "Pick a file inside the shared folder",
        )));
    }
    if !row.is_dir && !rel.is_empty() {
        return Err(share_not_found());
    }

    let effective = if rel.is_empty() {
        row.path.clone()
    } else {
        format!("{}/{rel}", row.path)
    };
    if !effective.starts_with(&row.path) {
        return Err(share_not_found());
    }

    files::serve_file(state, &headers, &row.username, &effective, disposition, row.sha256_hex).await
}

pub async fn share_download_public(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(token): Path<String>,
    Query(query): Query<PublicShareQuery>,
) -> Result<Response, ApiError> {
    serve_share_file(&state, headers, &token, query, Disposition::Attachment).await
}

pub async fn share_preview(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(token): Path<String>,
    Query(query): Query<PublicShareQuery>,
) -> Result<Response, ApiError> {
    serve_share_file(&state, headers, &token, query, Disposition::Inline).await
}

/// GET /share/:token  (web mode)
/// Отдаёт SPA share-viewer-web для активной ссылки. Ссылка проверяется до
/// отдачи HTML, поэтому `/share/<неизвестный-токен>` → 404, а не пустой UI.
/// `/share` без токена маршрута не имеет вовсе.
pub async fn share_page(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Response, ApiError> {
    let now = Utc::now().timestamp();
    let row = fetch_share(&state, &token).await?;
    if !row.active_at(now) {
        return Err(share_not_found());
    }

    let dir = state
        .config
        .share_web_dir
        .clone()
        .ok_or_else(|| internal("share web interface is not configured"))?;
    let index = dir.join("index.html");
    let bytes = tokio::fs::read(&index)
        .await
        .map_err(|e| internal(&format!("Failed to read share web interface: {e}")))?;

    let mut response = Response::new(Body::from(bytes));
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static("text/html; charset=utf-8"));
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    Ok(response)
}

// ─── Legacy-режим (без share-viewer-web) ───────────────────────────────────

/// GET /share/:token  (public, no auth, legacy)
/// Отдаёт сам файл inline, когда веб-интерфейс не раздаётся.
pub async fn share_view(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(token): Path<String>,
) -> Result<Response, ApiError> {
    let row = fetch_share(&state, &token).await?;
    if !row.active_at(Utc::now().timestamp()) {
        return Err(share_not_found());
    }
    legacy_password_guard(&row)?;
    files::serve_file(
        &state,
        &headers,
        &row.username,
        &row.path,
        Disposition::Inline,
        row.sha256_hex,
    )
    .await
}

/// GET /share/:token/download  (public, no auth, legacy)
pub async fn share_download(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(token): Path<String>,
) -> Result<Response, ApiError> {
    let row = fetch_share(&state, &token).await?;
    if !row.active_at(Utc::now().timestamp()) {
        return Err(share_not_found());
    }
    legacy_password_guard(&row)?;
    files::serve_file(
        &state,
        &headers,
        &row.username,
        &row.path,
        Disposition::Attachment,
        row.sha256_hex,
    )
    .await
}