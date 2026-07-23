use std::time::{SystemTime, UNIX_EPOCH};

use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::{
    extract::{ConnectInfo, Path, State},
    http::StatusCode,
    response::Json,
};
use password_hash::SaltString;
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::net::{IpAddr, SocketAddr};
use uuid::Uuid;

use crate::db::{AppState, repository};
use crate::handlers::jwt::{self, Claims};
use crate::models::{
    ChangePasswordRequest, CreateUserRequest, PublicUser, ROLE_ADMIN, ROLE_USER, Session,
    UpdateQuotaRequest, User,
};

#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
    #[serde(default = "default_device")]
    pub device: String,
}

fn default_device() -> String {
    "Unknown device".to_string()
}

#[derive(Serialize)]
pub struct LoginResponse {
    pub token: String,
    pub username: String,
    pub display_name: String,
    pub role: String,
    pub expires_at: u64,
}

#[derive(Serialize)]
pub struct UserInfo {
    pub username: String,
    pub display_name: String,
    pub role: String,
    pub session_created_at: u64,
}

#[derive(Serialize)]
pub struct ErrorResponse {
    pub error: String,
    pub code: String,
}

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub uptime_secs: u64,
}

type ApiError = (StatusCode, Json<ErrorResponse>);

pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn error_with(status: StatusCode, code: &str, message: &str) -> ApiError {
    (
        status,
        Json(ErrorResponse {
            error: message.to_string(),
            code: code.to_string(),
        }),
    )
}

fn unauthorized(code: &str, message: &str) -> ApiError {
    error_with(StatusCode::UNAUTHORIZED, code, message)
}

fn database_error(error: sqlx::Error) -> ApiError {
    tracing::error!(error = %error, "database operation failed");
    error_with(
        StatusCode::SERVICE_UNAVAILABLE,
        "DATABASE_UNAVAILABLE",
        "The database is temporarily unavailable",
    )
}

fn is_unique_violation(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|database_error| database_error.code())
        .is_some_and(|code| code == "23505")
}

fn normalize_username(username: &str) -> Result<String, ApiError> {
    let username = username.trim().to_lowercase();
    let valid = username.len() >= 3
        && username.len() <= 32
        && username
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-');
    if valid {
        Ok(username)
    } else {
        Err(error_with(
            StatusCode::BAD_REQUEST,
            "INVALID_USERNAME",
            "Username must be 3-32 chars and contain only latin letters, digits, _ or -",
        ))
    }
}

fn validate_password(password: &str) -> Result<(), ApiError> {
    if password.len() < 12 {
        return Err(error_with(
            StatusCode::BAD_REQUEST,
            "WEAK_PASSWORD",
            "Password must contain at least 12 characters",
        ));
    }
    Ok(())
}

fn validate_quota(quota_bytes: Option<u64>) -> Result<(), ApiError> {
    if quota_bytes.is_some_and(|value| value > i64::MAX as u64) {
        return Err(error_with(
            StatusCode::BAD_REQUEST,
            "INVALID_QUOTA",
            "Quota exceeds the maximum supported value",
        ));
    }
    Ok(())
}

fn normalize_role(role: Option<String>) -> Result<String, ApiError> {
    match role.unwrap_or_else(|| ROLE_USER.to_string()).as_str() {
        ROLE_ADMIN => Ok(ROLE_ADMIN.to_string()),
        ROLE_USER => Ok(ROLE_USER.to_string()),
        _ => Err(error_with(
            StatusCode::BAD_REQUEST,
            "INVALID_ROLE",
            "Role must be admin or user",
        )),
    }
}

async fn hash_password(password: String) -> Result<String, ApiError> {
    tokio::task::spawn_blocking(move || {
        let salt = SaltString::generate(&mut OsRng);
        Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map(|hash| hash.to_string())
    })
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "password hashing task failed");
        error_with(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "Internal server error",
        )
    })?
    .map_err(|error| {
        tracing::error!(error = %error, "password hashing failed");
        error_with(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "Internal server error",
        )
    })
}

async fn verify_password(password: String, hash: String) -> bool {
    tokio::task::spawn_blocking(move || {
        PasswordHash::new(&hash).ok().is_some_and(|parsed| {
            Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok()
        })
    })
    .await
    .unwrap_or(false)
}

fn token_hash(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}

pub async fn touch_session(state: &AppState, token: &str) -> Option<(Claims, Session)> {
    let claims = jwt::verify_token(&state.config.jwt_secret, token)?;
    let mut session = repository::touch_session(&state.pool, &token_hash(token), now_secs())
        .await
        .ok()??;
    session.token = token.to_string();
    Some((claims, session))
}

fn token_from_headers(headers: &axum::http::HeaderMap) -> &str {
    headers
        .get("x-session-token")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
}

pub async fn require_session(
    state: &AppState,
    headers: &axum::http::HeaderMap,
) -> Result<(Claims, Session), ApiError> {
    let token = token_from_headers(headers);
    if token.is_empty() {
        return Err(unauthorized("NO_TOKEN", "Missing session token"));
    }
    touch_session(state, token)
        .await
        .ok_or_else(|| unauthorized("INVALID_TOKEN", "Invalid or expired session"))
}

async fn require_admin(
    state: &AppState,
    headers: &axum::http::HeaderMap,
) -> Result<(Claims, Session), ApiError> {
    let (claims, session) = require_session(state, headers).await?;
    if claims.role != ROLE_ADMIN {
        return Err(error_with(
            StatusCode::FORBIDDEN,
            "FORBIDDEN",
            "Administrator role is required",
        ));
    }
    Ok((claims, session))
}

pub async fn bootstrap_admin(pool: &sqlx::PgPool) -> Result<(), String> {
    let count = repository::count_users(pool)
        .await
        .map_err(|error| error.to_string())?;
    if count > 0 {
        return Ok(());
    }

    let username = std::env::var("BOOTSTRAP_ADMIN_USERNAME").map_err(|_| {
        "database is empty; set BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD".to_string()
    })?;
    let password = std::env::var("BOOTSTRAP_ADMIN_PASSWORD").map_err(|_| {
        "database is empty; set BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD".to_string()
    })?;
    let username = normalize_username(&username).map_err(|(_, body)| body.0.error)?;
    validate_password(&password).map_err(|(_, body)| body.0.error)?;

    let user = User {
        username: username.clone(),
        password_hash: hash_password(password)
            .await
            .map_err(|(_, body)| body.0.error)?,
        display_name: std::env::var("BOOTSTRAP_ADMIN_DISPLAY_NAME").unwrap_or(username),
        role: ROLE_ADMIN.to_string(),
        quota_bytes: None,
    };
    repository::create_user(pool, &user)
        .await
        .map_err(|error| error.to_string())?;
    tracing::info!(username = %user.username, "bootstrap administrator created");
    Ok(())
}

pub async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        uptime_secs: now_secs().saturating_sub(state.started_at),
    })
}

pub async fn login(
    State(state): State<AppState>,
    ConnectInfo(remote_addr): ConnectInfo<SocketAddr>,
    headers: axum::http::HeaderMap,
    Json(req): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, ApiError> {
    let username = req.username.trim().to_lowercase();
    if username.is_empty() || req.password.is_empty() {
        return Err(unauthorized(
            "EMPTY_FIELDS",
            "Username and password are required",
        ));
    }
    let now = now_secs();
    let remote_ip = client_ip(&state, &headers, remote_addr);
    if state.is_login_rate_limited(remote_ip, &username, now) {
        tracing::warn!(%remote_ip, username = %username, "login rate limit exceeded");
        return Err(error_with(
            StatusCode::TOO_MANY_REQUESTS,
            "TOO_MANY_LOGIN_ATTEMPTS",
            "Too many failed login attempts; try again later",
        ));
    }
    let user = match repository::find_user(&state.pool, &username)
        .await
        .map_err(database_error)?
    {
        Some(user) => user,
        None => {
            state.record_login_failure(remote_ip, &username, now);
            tracing::warn!(%remote_ip, username = %username, "login rejected: invalid credentials");
            return Err(unauthorized(
                "INVALID_CREDENTIALS",
                "Invalid username or password",
            ));
        }
    };

    if !verify_password(req.password, user.password_hash.clone()).await {
        state.record_login_failure(remote_ip, &username, now);
        tracing::warn!(%remote_ip, username = %username, "login rejected: invalid credentials");
        return Err(unauthorized(
            "INVALID_CREDENTIALS",
            "Invalid username or password",
        ));
    }
    state.clear_login_failures(remote_ip, &username);

    let (token, expires_at) = jwt::issue_token(
        &state.config.jwt_secret,
        &username,
        &user.role,
        &user.display_name,
        &req.device,
    );
    let session = Session {
        public_id: Uuid::new_v4().to_string(),
        token: token.clone(),
        username: username.clone(),
        device: req.device,
        created_at: now,
        last_seen: now,
        expires_at,
    };
    repository::create_session(&state.pool, &token_hash(&token), &session)
        .await
        .map_err(database_error)?;
    tracing::info!(username = %username, role = %user.role, "login successful");
    Ok(Json(LoginResponse {
        token,
        username,
        display_name: user.display_name,
        role: user.role,
        expires_at,
    }))
}

fn client_ip(state: &AppState, headers: &axum::http::HeaderMap, remote_addr: SocketAddr) -> IpAddr {
    if state.config.trust_proxy_headers {
        if let Some(ip) = headers
            .get("x-forwarded-for")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(',').next())
            .and_then(|value| value.trim().parse().ok())
        {
            return ip;
        }
    }
    remote_addr.ip()
}

pub async fn me(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<UserInfo>, ApiError> {
    let (_, session) = require_session(&state, &headers).await?;
    let user = repository::find_user(&state.pool, &session.username)
        .await
        .map_err(database_error)?
        .ok_or_else(|| unauthorized("INVALID_TOKEN", "Invalid or expired session"))?;
    Ok(Json(UserInfo {
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        session_created_at: session.created_at,
    }))
}

pub async fn list_users(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<Vec<PublicUser>>, ApiError> {
    require_admin(&state, &headers).await?;
    repository::list_users(&state.pool)
        .await
        .map(Json)
        .map_err(database_error)
}

pub async fn create_user(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<CreateUserRequest>,
) -> Result<Json<PublicUser>, ApiError> {
    require_admin(&state, &headers).await?;
    let username = normalize_username(&req.username)?;
    validate_password(&req.password)?;
    validate_quota(req.quota_bytes)?;
    let user = User {
        username: username.clone(),
        password_hash: hash_password(req.password).await?,
        display_name: req
            .display_name
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| username.clone()),
        role: normalize_role(req.role)?,
        quota_bytes: req.quota_bytes,
    };
    match repository::create_user(&state.pool, &user).await {
        Ok(()) => {
            tracing::info!(username = %user.username, role = %user.role, "user created");
            Ok(Json(user.public()))
        }
        Err(error) if is_unique_violation(&error) => Err(error_with(
            StatusCode::CONFLICT,
            "USER_EXISTS",
            "User already exists",
        )),
        Err(error) => Err(database_error(error)),
    }
}

pub async fn change_password(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(username): Path<String>,
    Json(req): Json<ChangePasswordRequest>,
) -> Result<StatusCode, ApiError> {
    let (claims, _) = require_session(&state, &headers).await?;
    let target = normalize_username(&username)?;
    let self_change = claims.sub == target;
    if !self_change && claims.role != ROLE_ADMIN {
        return Err(error_with(
            StatusCode::FORBIDDEN,
            "FORBIDDEN",
            "Not allowed",
        ));
    }
    validate_password(&req.new_password)?;
    let user = repository::find_user(&state.pool, &target)
        .await
        .map_err(database_error)?
        .ok_or_else(|| error_with(StatusCode::NOT_FOUND, "USER_NOT_FOUND", "User not found"))?;
    if self_change
        && !verify_password(req.current_password.unwrap_or_default(), user.password_hash).await
    {
        return Err(error_with(
            StatusCode::FORBIDDEN,
            "INVALID_CURRENT_PASSWORD",
            "Current password is invalid",
        ));
    }
    let password_hash = hash_password(req.new_password).await?;
    repository::update_password(&state.pool, &target, &password_hash)
        .await
        .map_err(database_error)?;
    repository::delete_sessions_for_user(&state.pool, &target)
        .await
        .map_err(database_error)?;
    tracing::info!(username = %target, "password changed and sessions revoked");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn update_user_quota(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(username): Path<String>,
    Json(req): Json<UpdateQuotaRequest>,
) -> Result<Json<PublicUser>, ApiError> {
    require_admin(&state, &headers).await?;
    let target = normalize_username(&username)?;
    validate_quota(req.quota_bytes)?;
    let user = repository::update_quota(&state.pool, &target, req.quota_bytes)
        .await
        .map_err(database_error)?
        .ok_or_else(|| error_with(StatusCode::NOT_FOUND, "USER_NOT_FOUND", "User not found"))?;
    tracing::info!(username = %target, quota_bytes = ?user.quota_bytes, "quota updated");
    Ok(Json(user))
}

pub async fn delete_user(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(username): Path<String>,
) -> Result<StatusCode, ApiError> {
    let (claims, _) = require_admin(&state, &headers).await?;
    let target = normalize_username(&username)?;
    if claims.sub == target {
        return Err(error_with(
            StatusCode::BAD_REQUEST,
            "CANNOT_DELETE_SELF",
            "You cannot delete your own account",
        ));
    }
    if !repository::delete_user(&state.pool, &target)
        .await
        .map_err(database_error)?
    {
        return Err(error_with(
            StatusCode::NOT_FOUND,
            "USER_NOT_FOUND",
            "User not found",
        ));
    }
    tracing::warn!(username = %target, "user deleted and sessions revoked");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn logout(State(state): State<AppState>, headers: axum::http::HeaderMap) -> StatusCode {
    if let Some(token) = headers
        .get("x-session-token")
        .and_then(|value| value.to_str().ok())
    {
        let removed = repository::delete_session(&state.pool, &token_hash(token))
            .await
            .unwrap_or(false);
        tracing::info!(removed, "logout");
    }
    StatusCode::NO_CONTENT
}

pub async fn refresh(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<LoginResponse>, ApiError> {
    let old_token = token_from_headers(&headers);
    if old_token.is_empty() {
        return Err(unauthorized("NO_TOKEN", "Missing session token"));
    }
    let (claims, old_session) = touch_session(&state, old_token)
        .await
        .ok_or_else(|| unauthorized("INVALID_TOKEN", "Invalid or expired session"))?;
    let (new_token, expires_at) = jwt::issue_token(
        &state.config.jwt_secret,
        &claims.sub,
        &claims.role,
        &claims.display_name,
        &old_session.device,
    );
    let now = now_secs();
    let new_session = Session {
        public_id: old_session.public_id,
        token: new_token.clone(),
        username: old_session.username,
        device: old_session.device,
        created_at: old_session.created_at,
        last_seen: now,
        expires_at,
    };
    repository::delete_session(&state.pool, &token_hash(old_token))
        .await
        .map_err(database_error)?;
    repository::create_session(&state.pool, &token_hash(&new_token), &new_session)
        .await
        .map_err(database_error)?;
    Ok(Json(LoginResponse {
        token: new_token,
        username: claims.sub,
        display_name: claims.display_name,
        role: claims.role,
        expires_at,
    }))
}
