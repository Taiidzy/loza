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
    let server_url = server_config::require_server_url(&app)?;
    let device = device_label();
    let login_url = format!("{}/auth/login", server_url);

    eprintln!("\x1b[36m[INFO]\x1b[0m [desktop.auth] login request for {username} from {device}");

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
            eprintln!("\x1b[33m[WARNING]\x1b[0m [desktop.auth] login request failed: {e}");
            format!("SERVER_UNREACHABLE: {}", e)
        })?;

    let status = resp.status();
    eprintln!("\x1b[90m[DEBUG]\x1b[0m [desktop.auth] login response: {status}");

    let ok = status.is_success();
    if !ok {
        let raw_body = resp.text().await.unwrap_or_default();
        let err = serde_json::from_str::<ServerErrorResponse>(&raw_body).ok();
        eprintln!(
            "\x1b[33m[WARNING]\x1b[0m [desktop.auth] login rejected: HTTP {status}, code={}",
            err.as_ref()
                .map(|body| body.code.as_str())
                .unwrap_or("UNKNOWN")
        );
        return Err(describe_error(
            err,
            &format!("UNKNOWN: Login failed (HTTP {})", status),
        ));
    }

    let raw_body = resp.text().await.map_err(|e| {
        eprintln!("\x1b[31m[ERROR]\x1b[0m [desktop.auth] failed to read login response: {e}");
        format!("PARSE_ERROR: {}", e)
    })?;

    let login_resp = serde_json::from_str::<ServerLoginResponse>(&raw_body).map_err(|e| {
        eprintln!("\x1b[31m[ERROR]\x1b[0m [desktop.auth] failed to parse login response: {e}");
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

    eprintln!(
        "\x1b[32m[SUCCESS]\x1b[0m [desktop.auth] login successful for {} ({})",
        session.username, session.role
    );

    Ok(UserInfo::from(&session))
}

/// `invoke("get_current_user")`
/// Возвращает текущего залогиненного пользователя (без токена) или `null`,
/// если сессии нет. Используется ProtectedRoute для проверки при старте.
///
/// Валидирует сессию против сервера (через /auth/me) — если токен истёк или
/// отозван, локальная сессия очищается и возвращается None. Но перед тем как
/// сдаться, делает две попытки:
///   1. Заново читает сессию из хранилища — её мог ротировать параллельный
///      refresh при старте (гонка: /auth/refresh уже удалил старую строку, и
///      наша копия токена стала невалидной даже при живом пользователе).
///   2. Пытается тихо продлить сессию (/auth/refresh) и проверяет /auth/me
///      уже новым токеном. Только если и это не помогло — сессия мертва.
#[tauri::command]
pub async fn get_current_user(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
) -> Result<Option<UserInfo>, String> {
    eprintln!("\x1b[36m[INFO]\x1b[0m [desktop.auth] get_current_user called");

    // 1. Проверяем наличие локальной сессии
    let Some(mut session) = session_store::load_session(&app) else {
        eprintln!("\x1b[33m[WARNING]\x1b[0m [desktop.auth] no local session found in keyring");
        return Ok(None);
    };
    eprintln!("\x1b[90m[DEBUG]\x1b[0m [desktop.auth] local session loaded for user: {}", session.username);

    // 2. Проверяем наличие адреса сервера
    let Some(server_url) = server_config::load_server_url(&app) else {
        eprintln!("\x1b[33m[WARNING]\x1b[0m [desktop.auth] no server URL configured");
        return Ok(None);
    };

    // Проверка токена на сервере. `Invalid` значит, что сервер явно отверг
    // токен (401/403); `Unavailable` — сервер не ответил или 5xx, сессию
    // трогать нельзя.
    let mut tried_tokens = std::collections::HashSet::new();
    let mut refresh_tried = false;
    loop {
        let token = session.token.clone();
        if !tried_tokens.insert(token.clone()) {
            // Уже проверяли этот токен — новых вариантов не осталось.
            break;
        }

        match check_me_token(&state.client, &server_url, &token).await {
            CheckMe::Valid => {
                // Refresh мог ротировать токен — перечитываем свежую сессию,
                // чтобы вернуть актуальные данные пользователя.
                return Ok(Some(UserInfo::from(
                    session_store::load_session(&app).as_ref().unwrap_or(&session),
                )));
            }
            CheckMe::Unavailable => {
                eprintln!("\x1b[33m[WARNING]\x1b[0m [desktop.auth] /auth/me unavailable; keeping local session");
                return Ok(Some(UserInfo::from(&session)));
            }
            CheckMe::Invalid => {
                eprintln!("\x1b[90m[DEBUG]\x1b[0m [desktop.auth] /auth/me rejected token; probing for a fresher one");
                // (a) Гонка со стартовым refresh: в хранилище уже может лежать
                // новый токен. Если он отличается — пробуем его следующим.
                if let Some(newest) = session_store::load_session(&app) {
                    if newest.token != token {
                        session = newest;
                        continue;
                    }
                }
                // (b) Токен действительно старый/просрочен — пробуем тихо
                // продлить сессию один раз и повторить с новым токеном.
                if !refresh_tried {
                    refresh_tried = true;
                    if refresh_session_silently(&app, &state.client).await {
                        if let Some(newest) = session_store::load_session(&app) {
                            session = newest;
                            continue;
                        }
                    }
                }
                // (c) Ничего не помогло — сессия мертва, чистим.
                let _ = session_store::clear_session(&app);
                return Ok(None);
            }
        }
    }

    let _ = session_store::clear_session(&app);
    Ok(None)
}

enum CheckMe {
    Valid,
    Invalid,
    Unavailable,
}

async fn check_me_token(client: &reqwest::Client, server_url: &str, token: &str) -> CheckMe {
    let resp = match client
        .get(format!("{server_url}/auth/me"))
        .header("x-session-token", token)
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(e) => {
            eprintln!("\x1b[31m[ERROR]\x1b[0m [desktop.auth] network error during /auth/me: {e}");
            return CheckMe::Unavailable;
        }
    };
    let status = resp.status();
    eprintln!("\x1b[90m[DEBUG]\x1b[0m [desktop.auth] /auth/me response status: {status}");
    if status.is_success() {
        CheckMe::Valid
    } else if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        CheckMe::Invalid
    } else {
        CheckMe::Unavailable
    }
}

/// `invoke("logout")`
/// Отзывает сессию на сервере и удаляет её из локального хранилища.
#[tauri::command]
pub async fn logout(app: AppHandle, state: tauri::State<'_, LozaState>) -> Result<(), String> {
    if let (Some(session), Some(server_url)) = (
        session_store::load_session(&app),
        server_config::load_server_url(&app),
    ) {
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
    eprintln!("\x1b[90m[DEBUG]\x1b[0m [desktop.auth] health check: {health_url}");

    let resp = state.client.get(&health_url).send().await;
    match &resp {
        Ok(response) => eprintln!(
            "\x1b[90m[DEBUG]\x1b[0m [desktop.auth] health check response: {}",
            response.status()
        ),
        Err(error) => {
            eprintln!("\x1b[33m[WARNING]\x1b[0m [desktop.auth] health check failed: {error}")
        }
    }

    Ok(resp.map(|r| r.status().is_success()).unwrap_or(false))
}

/// Тихо продлевает токен сессии на сервере (/auth/refresh) и обновляет
/// локальное хранилище. Вызывается при старте приложения (см. lib.rs::run)
/// и периодически во время работы, пока пользователь залогинен — так TTL
/// токена не ощущается пользователем, и после перезапуска приложения не нужно
/// входить заново.
///
/// Возвращает `true`, если удалось продлить сессию (хранилище обновлено).
/// При явном отказе сервера (INVALID_TOKEN и т.п.) сессия очищается и
/// возвращается `false`.
pub async fn refresh_session_silently(app: &AppHandle, client: &reqwest::Client) -> bool {
    let Some(session) = session_store::load_session(app) else {
        return false;
    };
    let Some(server_url) = server_config::load_server_url(app) else {
        return false;
    };

    eprintln!(
        "\x1b[90m[DEBUG]\x1b[0m [desktop.auth] refreshing session for {}",
        session.username
    );

    let resp = client
        .post(format!("{}/auth/refresh", server_url))
        .header("x-session-token", &session.token)
        .send()
        .await;

    let Ok(resp) = resp else {
        // Сервер недоступен — оставляем старую сессию как есть, попробуем в следующий раз.
        eprintln!("\x1b[33m[WARNING]\x1b[0m [desktop.auth] refresh request failed (server unreachable)");
        return false;
    };

    if !resp.status().is_success() {
        // Токен отозван/истёк по-настоящему — чистим локальную сессию,
        // ProtectedRoute на фронте перекинет на экран логина при следующей проверке.
        eprintln!(
            "\x1b[33m[WARNING]\x1b[0m [desktop.auth] refresh rejected with HTTP {}; clearing session",
            resp.status()
        );
        let _ = session_store::clear_session(app);
        return false;
    }

    match resp.json::<ServerLoginResponse>().await {
        Ok(login_resp) => {
            let new_session = StoredSession {
                token: login_resp.token,
                username: login_resp.username,
                display_name: login_resp.display_name,
                role: login_resp.role,
                device: session.device,
                expires_at: login_resp.expires_at,
            };
            let saved = session_store::save_session(app, &new_session);
            eprintln!(
                "\x1b[32m[SUCCESS]\x1b[0m [desktop.auth] session refreshed for {} (saved: {})",
                new_session.username, saved.is_ok()
            );
            saved.is_ok()
        }
        Err(_) => {
            // The server accepted the refresh (old token already rotated) but
            // the body did not parse. Keeping the old token would leave a
            // possibly-invalidated session in place — clear it so the UI shows
            // login instead of a dead session.
            eprintln!(
                "\x1b[31m[ERROR]\x1b[0m [desktop.auth] failed to parse refresh response; clearing session"
            );
            let _ = session_store::clear_session(app);
            false
        }
    }
}
