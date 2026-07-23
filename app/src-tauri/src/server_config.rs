//! Хранилище адреса сервера на стороне Tauri (Rust).
//!
//! Раньше SERVER_URL был константой, вкопанной в auth.rs/status.rs/calendar.rs
//! (`http://localhost:4242`) — предполагалось, что сервер всегда локальный.
//! Теперь адрес вводится один раз на первом экране (см. React ServerSetupPage)
//! и хранится здесь, персистентно на диске через tauri-plugin-store. Токены
//! сессий хранятся отдельно в системном credential storage. auth.rs/status.rs/
//! calendar.rs читают адрес через
//! `require_server_url()` вместо константы.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "session.json";
const SERVER_URL_KEY: &str = "server_url";

#[derive(Debug, Serialize, Deserialize, Clone)]
struct StoredServerUrl {
    url: String,
}

/// Принимает HTTPS для любого сервера и HTTP только для loopback/LAN адресов.
/// Это сохраняет поддержку домашней сети, но не позволяет случайно отправить
/// пароль или bearer-токен на публичный сервер по открытому HTTP.
pub fn normalize(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }

    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("http://{}", trimmed)
    };

    let mut parsed = url::Url::parse(&with_scheme).ok()?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.username() != ""
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || !matches!(parsed.path(), "" | "/")
    {
        return None;
    }
    if parsed.scheme() == "http" && !is_local_network_host(parsed.host()?) {
        return None;
    }
    parsed.set_path("");
    Some(parsed.to_string().trim_end_matches('/').to_string())
}

fn is_local_network_host(host: url::Host<&str>) -> bool {
    match host {
        url::Host::Domain(domain) => {
            domain.eq_ignore_ascii_case("localhost") || domain.ends_with(".local")
        }
        url::Host::Ipv4(address) => {
            address.is_loopback() || address.is_private() || address.is_link_local()
        }
        url::Host::Ipv6(address) => {
            address.is_loopback() || address.is_unique_local() || address.is_unicast_link_local()
        }
    }
}

pub fn save_server_url(app: &AppHandle, url: &str) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let value = serde_json::to_value(StoredServerUrl {
        url: url.to_string(),
    })
    .map_err(|e| e.to_string())?;
    store.set(SERVER_URL_KEY, value);
    store.save().map_err(|e| e.to_string())
}

pub fn load_server_url(app: &AppHandle) -> Option<String> {
    let store = app.store(STORE_FILE).ok()?;
    let value = store.get(SERVER_URL_KEY)?;
    let stored: StoredServerUrl = serde_json::from_value(value).ok()?;
    normalize(&stored.url)
}

pub fn delete_server_url(app: &AppHandle) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.delete(SERVER_URL_KEY);
    store.save().map_err(|e| e.to_string())
}

/// Helper для команд, которым сервер обязателен (почти все) — единая
/// точка правды вместо константы SERVER_URL.
pub fn require_server_url(app: &AppHandle) -> Result<String, String> {
    load_server_url(app).ok_or_else(|| "NO_SERVER_URL: Server address not configured".to_string())
}

/// Вариант выше, но принимает уже известный адрес сервера напрямую —
/// используется в status.rs, где адрес читается один раз за итерацию
/// цикла переподключения, а не на каждый чих.
pub fn require_ws_url_from(server_url: &str, path: &str) -> Result<String, String> {
    let mut parsed = url::Url::parse(server_url).map_err(|e| format!("PARSE_ERROR: {}", e))?;

    let ws_scheme = match parsed.scheme() {
        "https" => "wss",
        _ => "ws",
    };
    parsed
        .set_scheme(ws_scheme)
        .map_err(|_| "PARSE_ERROR: could not set ws scheme".to_string())?;
    parsed.set_path(path);

    Ok(parsed.to_string())
}

// ─── Команды, вызываемые React через invoke ─────────────────────────────────

/// `invoke("get_server_url")` — текущий сохранённый адрес, или null, если
/// ещё не настроен (первый запуск).
#[tauri::command]
pub fn get_server_url(app: AppHandle) -> Option<String> {
    load_server_url(&app)
}

/// `invoke("set_server_url", { url })` — нормализует и сохраняет адрес.
/// Возвращает нормализованный адрес, чтобы React мог отобразить его как есть.
#[tauri::command]
pub fn set_server_url(app: AppHandle, url: String) -> Result<String, String> {
    let normalized =
        normalize(&url).ok_or_else(|| "INVALID_URL: Некорректный адрес сервера".to_string())?;
    save_server_url(&app, &normalized)?;
    Ok(normalized)
}

/// `invoke("clear_server_url")` — используется на экране "Сменить сервер".
#[tauri::command]
pub fn clear_server_url(app: AppHandle) -> Result<(), String> {
    delete_server_url(&app)
}

#[cfg(test)]
mod tests {
    use super::normalize;

    #[test]
    fn allows_https_everywhere_and_http_only_in_local_networks() {
        assert!(normalize("https://loza.example.com").is_some());
        assert!(normalize("http://localhost:4242").is_some());
        assert!(normalize("http://192.168.1.25:4242").is_some());
        assert!(normalize("http://loza.local:4242").is_some());
        assert!(normalize("http://loza.example.com").is_none());
    }

    #[test]
    fn rejects_non_http_urls_and_embedded_credentials() {
        assert!(normalize("ftp://192.168.1.25").is_none());
        assert!(normalize("https://user:password@loza.example.com").is_none());
        assert!(normalize("https://loza.example.com/api").is_none());
    }
}
