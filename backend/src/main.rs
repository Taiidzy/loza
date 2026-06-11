use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, RwLock},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

// ─── State ────────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct AppState {
    sessions: Arc<RwLock<HashMap<String, Session>>>,
    users: Arc<RwLock<HashMap<String, User>>>,
}

#[derive(Clone, Debug)]
pub struct User {
    pub username: String,
    pub password_hash: String,
    pub display_name: String,
    pub role: String,
}

#[derive(Clone, Debug)]
pub struct Session {
    pub token: String,
    pub username: String,
    pub created_at: u64,
    pub expires_at: u64,
}

// ─── Request / Response types ─────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
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

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

/// Very simple hash — in production use argon2 / bcrypt
fn hash_password(password: &str) -> String {
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

// ─── Handlers ─────────────────────────────────────────────────────────────────

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    let sessions = state.sessions.read().unwrap();
    Json(HealthResponse {
        status: "ok".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        uptime_secs: sessions.len() as u64, // placeholder
    })
}

async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, (StatusCode, Json<ErrorResponse>)> {
    let username = req.username.trim().to_lowercase();

    if username.is_empty() || req.password.is_empty() {
        return Err(error("EMPTY_FIELDS", "Username and password are required"));
    }

    let password_hash = hash_password(&req.password);

    // Lookup user
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

    // Create session — 24h TTL
    let token = Uuid::new_v4().to_string();
    let now = now_secs();
    let expires_at = now + 86_400;

    let session = Session {
        token: token.clone(),
        username: username.clone(),
        created_at: now,
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

async fn me(
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

    let session = {
        let sessions = state.sessions.read().unwrap();
        sessions.get(token).cloned()
    };

    let session = match session {
        Some(s) => s,
        None => return Err(error("INVALID_TOKEN", "Invalid or expired session")),
    };

    if now_secs() > session.expires_at {
        state.sessions.write().unwrap().remove(token);
        return Err(error("EXPIRED_TOKEN", "Session has expired"));
    }

    let users = state.users.read().unwrap();
    let user = users.get(&session.username).cloned().unwrap();

    Ok(Json(UserInfo {
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        session_created_at: session.created_at,
    }))
}

async fn logout(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> StatusCode {
    if let Some(token) = headers
        .get("x-session-token")
        .and_then(|v| v.to_str().ok())
    {
        state.sessions.write().unwrap().remove(token);
    }
    StatusCode::NO_CONTENT
}

// ─── Seed data ────────────────────────────────────────────────────────────────

fn seed_users() -> HashMap<String, User> {
    let mut m = HashMap::new();

    // Default admin account: admin / loza2024
    m.insert(
        "admin".to_string(),
        User {
            username: "admin".to_string(),
            password_hash: hash_password("loza2024"),
            display_name: "Administrator".to_string(),
            role: "admin".to_string(),
        },
    );

    // Regular user: loza / loza
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

// ─── Main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    let port = std::env::var("PORT").unwrap_or_else(|_| "4242".to_string());
    let addr = format!("127.0.0.1:{}", port);

    let state = AppState {
        sessions: Arc::new(RwLock::new(HashMap::new())),
        users: Arc::new(RwLock::new(seed_users())),
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/auth/login", post(login))
        .route("/auth/me", get(me))
        .route("/auth/logout", post(logout))
        .with_state(state);

    println!("🌿 Loza server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}