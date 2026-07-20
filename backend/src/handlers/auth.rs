use axum::{extract::State, http::StatusCode, response::Json};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::db::AppState;
use crate::handlers::jwt::{self, Claims};
use crate::models::Session;

// ─── Request / Response types ─────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
    /// Человекочитаемое описание клиента, например "macOS · Loza Desktop".
    /// Передаётся Tauri-слоем при логине. Используется как есть в ClientInfo.device.
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

/// Very simple hash — in production use argon2 / bcrypt
pub fn hash_password(password: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    format!("loza_salt_{}", password).hash(&mut h);
    format!("{:x}", h.finish())
}

fn error(code: &str, msg: &str) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::UNAUTHORIZED,
        Json(ErrorResponse {
            error: msg.to_string(),
            code: code.to_string(),
        }),
    )
}

/// Проверяет JWT (подпись + срок действия), затем сверяет с локальным реестром
/// сессий — токен может быть криптографически валиден, но уже отозван через
/// /auth/logout. Попутно обновляет last_seen для отображения активности клиента.
///
/// Возвращает (claims, session) при успехе.
pub fn touch_session(state: &AppState, token: &str) -> Option<(Claims, Session)> {
    let claims = jwt::verify_token(token)?;

    let mut sessions = state.sessions.write().unwrap();
    let session = sessions.get_mut(token)?;
    session.last_seen = now_secs();
    Some((claims, session.clone()))
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

pub async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    let sessions = state.sessions.read().unwrap();
    Json(HealthResponse {
        status: "ok".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        uptime_secs: sessions.len() as u64, // placeholder, как было в исходном коде
    })
}

pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, (StatusCode, Json<ErrorResponse>)> {
    let username = req.username.trim().to_lowercase();

    if username.is_empty() || req.password.is_empty() {
        return Err(error("EMPTY_FIELDS", "Username and password are required"));
    }

    let password_hash = hash_password(&req.password);

    let user = {
        let users = state.users.read().unwrap();
        users.get(&username).cloned()
    };

    let user = match user {
        Some(u) => u,
        None => return Err(error("INVALID_CREDENTIALS", "Invalid username or password")),
    };

    if user.password_hash != password_hash {
        return Err(error("INVALID_CREDENTIALS", "Invalid username or password"));
    }

    // Create session — JWT with TOKEN_TTL_SECS lifetime
    let (token, expires_at) = jwt::issue_token(&username, &user.role, &user.display_name, &req.device);
    let now = now_secs();

    let session = Session {
        token: token.clone(),
        username: username.clone(),
        device: req.device.clone(),
        created_at: now,
        last_seen: now,
        expires_at,
    };

    state.sessions.write().unwrap().insert(token.clone(), session);

    Ok(Json(LoginResponse {
        token,
        username,
        display_name: user.display_name,
        role: user.role,
        expires_at,
    }))
}

pub async fn me(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<UserInfo>, (StatusCode, Json<ErrorResponse>)> {
    let token = headers
        .get("x-session-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if token.is_empty() {
        return Err(error("NO_TOKEN", "Missing session token"));
    }

    let (_, session) = match touch_session(&state, token) {
        Some(s) => s,
        None => return Err(error("INVALID_TOKEN", "Invalid or expired session")),
    };

    let users = state.users.read().unwrap();
    let user = users.get(&session.username).cloned().unwrap();

    Ok(Json(UserInfo {
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        session_created_at: session.created_at,
    }))
}

pub async fn logout(State(state): State<AppState>, headers: axum::http::HeaderMap) -> StatusCode {
    if let Some(token) = headers.get("x-session-token").and_then(|v| v.to_str().ok()) {
        state.sessions.write().unwrap().remove(token);
    }
    StatusCode::NO_CONTENT
}

/// Тихо продлевает токен: если присланный токен валиден (даже недавно истёкший
/// в рамках небольшого допуска — на случай, если приложение не открывалось
/// пару секунд дольше TTL), выдаёт новый JWT с полным сроком жизни и обновляет
/// запись в реестре сессий. Вызывается Tauri-слоем при каждом запуске приложения,
/// пока пользователь остаётся залогинен — так TTL токена не ощущается пользователем.
pub async fn refresh(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<LoginResponse>, (StatusCode, Json<ErrorResponse>)> {
    let old_token = headers
        .get("x-session-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if old_token.is_empty() {
        return Err(error("NO_TOKEN", "Missing session token"));
    }

    let (claims, old_session) = match touch_session(&state, old_token) {
        Some(s) => s,
        None => return Err(error("INVALID_TOKEN", "Invalid or expired session")),
    };

    let (new_token, expires_at) =
        jwt::issue_token(&claims.sub, &claims.role, &claims.display_name, &old_session.device);
    let now = now_secs();

    let new_session = Session {
        token: new_token.clone(),
        username: old_session.username.clone(),
        device: old_session.device.clone(),
        created_at: old_session.created_at,
        last_seen: now,
        expires_at,
    };

    let mut sessions = state.sessions.write().unwrap();
    sessions.remove(old_token);
    sessions.insert(new_token.clone(), new_session);
    drop(sessions);

    Ok(Json(LoginResponse {
        token: new_token,
        username: claims.sub,
        display_name: claims.display_name,
        role: claims.role,
        expires_at,
    }))
}

// ─── Seed data ────────────────────────────────────────────────────────────────

pub fn seed_users() -> std::collections::HashMap<String, crate::models::User> {
    use crate::models::User;
    let mut m = std::collections::HashMap::new();

    m.insert(
        "admin".to_string(),
        User {
            username: "admin".to_string(),
            password_hash: hash_password("loza2024"),
            display_name: "Administrator".to_string(),
            role: "admin".to_string(),
        },
    );

    m.insert(
        "loza".to_string(),
        User {
            username: "loza".to_string(),
            password_hash: hash_password("loza"),
            display_name: "Loza User".to_string(),
            role: "user".to_string(),
        },
    );

    m
}
