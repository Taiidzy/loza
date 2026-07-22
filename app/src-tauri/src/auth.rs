//! Слой авторизации Tauri.
//!
//! React не хранит и не видит токен ни в каком виде — только безопасное
//! `UserInfo` (username/display_name/role). Токен живёт исключительно здесь,
//! персистентно на диске через tauri-plugin-store (см. session_store.rs),
//! и подставляется в запросы к backend'у самим Rust-слоем.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::server_config;
use crate::session_store::{self, StoredSession};
use crate::LozaState;

// ─── Типы ответа для React — без токена ────────────────────────────────────

/// То, что видит React после успешного логина/при проверке сессии.
/// Намеренно не содержит token — React не должен иметь к нему доступ.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserInfo {
    pub username: String,
    pub display_name: String,
    pub role: String,
}

impl From<&StoredSession> for UserInfo {
    fn from(s: &StoredSession) -> Self {
        UserInfo {
            username: s.username.clone(),
            display_name: s.display_name.clone(),
            role: s.role.clone(),
        }
    }
}

// ─── Типы ответа сервера (внутренние, не пересекают границу invoke) ────────

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ServerLoginResponse {
    token: String,
    username: String,
    display_name: String,
    role: String,
    expires_at: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct ServerErrorResponse {
    error: String,
    code: String,
}

fn describe_error(body: Option<ServerErrorResponse>, fallback: &str) -> String {
    match body {
        Some(e) => format!("{}: {}", e.code, e.error),
        None => fallback.to_string(),
    }
}

/// Человекочитаемое описание клиента — используется backend'ом для карточки
/// "Клиенты" на дашборде (ClientInfo.device).
fn device_label() -> String {
    format!("{} · Loza Desktop", std::env::consts::OS)
}

// ─── Команды, вызываемые React через invoke ─────────────────────────────────

/// `invoke("login", { username, password })`
/// Логинится на сервере, сохраняет сессию (с токеном) в Rust-хранилище,
/// возвращает React только безопасный UserInfo.
#[tauri::command]
pub async fn login(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    username: String,
    password: String,
) -> Result<UserInfo, String> {
    let server_url = server_config::require_server_url(&app).map_err(|e| {
        eprintln!("🔴 [login] адрес сервера не настроен: {}", e);
        e
    })?;
    let device = device_label();
    let login_url = format!("{}/auth/login", server_url);

    eprintln!("🔵 [login] POST {} (username={}, device={})", login_url, username, device);

    let body = serde_json::json!({
        "username": username,
        "password": password,
        "device": device,
    });

    let resp = state
        .client
        .post(&login_url)
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            eprintln!("🔴 [login] запрос не дошёл до сервера: {}", e);
            format!("SERVER_UNREACHABLE: {}", e)
        })?;

    let status = resp.status();
    eprintln!("🔵 [login] ответ сервера: HTTP {}", status);

    let ok = status.is_success();
    if !ok {
        // Читаем тело как текст сначала, чтобы залогировать его целиком
        // независимо от того, распарсится оно как ServerErrorResponse или нет —
        // именно это тело раньше терялось за generic "Login failed".
        let raw_body = resp.text().await.unwrap_or_default();
        eprintln!("🔴 [login] тело ошибки от сервера: {}", raw_body);

        let err = serde_json::from_str::<ServerErrorResponse>(&raw_body).ok();
        if err.is_none() {
            eprintln!(
                "🔴 [login] тело ошибки не распарсилось как {{error, code}} — проверьте, что \
                 /auth/login на сервере точно отвечает на этот URL (не 404 от неверного пути, \
                 не HTML от прокси, не другой сервис на этом порту)"
            );
        }
        return Err(describe_error(err, &format!("UNKNOWN: Login failed (HTTP {})", status)));
    }

    let raw_body = resp.text().await.map_err(|e| {
        eprintln!("🔴 [login] не удалось прочитать тело успешного ответа: {}", e);
        format!("PARSE_ERROR: {}", e)
    })?;

    let login_resp = serde_json::from_str::<ServerLoginResponse>(&raw_body).map_err(|e| {
        eprintln!("🔴 [login] тело успешного ответа не распарсилось как LoginResponse: {} | тело: {}", e, raw_body);
        format!("PARSE_ERROR: {}", e)
    })?;

    let session = StoredSession {
        token: login_resp.token,
        username: login_resp.username,
        display_name: login_resp.display_name,
        role: login_resp.role,
        device,
        expires_at: login_resp.expires_at,
    };

    session_store::save_session(&app, &session)?;

    eprintln!("🟢 [login] успех: username={}, role={}", session.username, session.role);

    Ok(UserInfo::from(&session))
}

/// `invoke("get_current_user")`
/// Возвращает текущего залогиненного пользователя (без токена) или `null`,
/// если сессии нет. Используется ProtectedRoute для проверки при старте.
///
/// Валидирует сессию против сервера (через /auth/me) — если токен истёк или
/// отозван, локальная сессия очищается и возвращается None.
#[tauri::command]
pub async fn get_current_user(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
) -> Result<Option<UserInfo>, String> {
    let Some(session) = session_store::load_session(&app) else {
        return Ok(None);
    };
    let Some(server_url) = server_config::load_server_url(&app) else {
        return Ok(None);
    };

    let resp = state
        .client
        .get(format!("{}/auth/me", server_url))
        .header("x-session-token", &session.token)
        .send()
        .await;

    match resp {
        Ok(r) if r.status().is_success() => Ok(Some(UserInfo::from(&session))),
        _ => {
            // Токен невалиден/истёк/сервер отверг — локальная сессия больше не актуальна.
            let _ = session_store::clear_session(&app);
            Ok(None)
        }
    }
}

/// `invoke("logout")`
/// Отзывает сессию на сервере и удаляет её из локального хранилища.
#[tauri::command]
pub async fn logout(app: AppHandle, state: tauri::State<'_, LozaState>) -> Result<(), String> {
    if let (Some(session), Some(server_url)) =
        (session_store::load_session(&app), server_config::load_server_url(&app))
    {
        let _ = state
            .client
            .post(format!("{}/auth/logout", server_url))
            .header("x-session-token", &session.token)
            .send()
            .await;
    }
    session_store::clear_session(&app)
}

/// Health check — used on startup to verify the server is running.
/// Принимает URL явно (не читает из стора сам), так как вызывается и до
/// того, как адрес сохранён — на экране ввода адреса сервера, чтобы
/// проверить его перед сохранением.
#[tauri::command]
pub async fn health_check(state: tauri::State<'_, LozaState>, url: String) -> Result<bool, String> {
    let health_url = format!("{}/health", url);
    eprintln!("🔵 [health_check] GET {}", health_url);

    let resp = state.client.get(&health_url).send().await;
    match &resp {
        Ok(r) => eprintln!("🔵 [health_check] ответ: HTTP {}", r.status()),
        Err(e) => eprintln!("🔴 [health_check] запрос не дошёл: {}", e),
    }

    Ok(resp.map(|r| r.status().is_success()).unwrap_or(false))
}

/// Тихо продлевает токен сессии на сервере (/auth/refresh) и обновляет
/// локальное хранилище. Вызывается один раз при старте приложения (см. lib.rs::run),
/// пока пользователь залогинен — так TTL токена не ощущается пользователем,
/// и после перезапуска приложения не нужно входить заново.
pub async fn refresh_session_silently(app: &AppHandle, client: &reqwest::Client) {
    let Some(session) = session_store::load_session(app) else {
        return;
    };
    let Some(server_url) = server_config::load_server_url(app) else {
        return;
    };

    let resp = client
        .post(format!("{}/auth/refresh", server_url))
        .header("x-session-token", &session.token)
        .send()
        .await;

    let Ok(resp) = resp else {
        return; // сервер недоступен — оставляем старую сессию как есть, попробуем в следующий раз
    };

    if !resp.status().is_success() {
        // Токен отозван/истёк по-настоящему — чистим локальную сессию,
        // ProtectedRoute на фронте перекинет на экран логина при следующей проверке.
        let _ = session_store::clear_session(app);
        return;
    }

    if let Ok(login_resp) = resp.json::<ServerLoginResponse>().await {
        let new_session = StoredSession {
            token: login_resp.token,
            username: login_resp.username,
            display_name: login_resp.display_name,
            role: login_resp.role,
            device: session.device,
            expires_at: login_resp.expires_at,
        };
        let _ = session_store::save_session(app, &new_session);
    }
}
