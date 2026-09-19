#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub port: u16,
    pub trust_proxy_headers: bool,
    /// Директория со сборочными артефактами share-viewer-web (dist),
    /// если приложение раздаётся этим сервером. None — режим legacy:
    /// `/share/:token` отдаёт тело файла, а не веб-интерфейс.
    pub share_web_dir: Option<std::path::PathBuf>,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let database_url = required("DATABASE_URL")?;
        let jwt_secret = required("JWT_SECRET")?;
        if jwt_secret.len() < 32 {
            return Err("JWT_SECRET must contain at least 32 bytes".to_string());
        }
        if is_placeholder_secret(&jwt_secret) {
            return Err(
                "JWT_SECRET must be a newly generated secret, not an example value".to_string(),
            );
        }

        let port = std::env::var("PORT")
            .unwrap_or_else(|_| "4242".to_string())
            .parse::<u16>()
            .map_err(|_| "PORT must be a valid TCP port".to_string())?;
        let trust_proxy_headers = optional_bool("TRUST_PROXY_HEADERS", false)?;
        let share_web_dir = resolve_share_web_dir();

        Ok(Self {
            database_url,
            jwt_secret,
            port,
            trust_proxy_headers,
            share_web_dir,
        })
    }
}

/// Ищет собранный `share-viewer-web`:
/// 1) явный `SHARE_WEB_DIR` (если указан, но не существует — возвращается
///    None с предупреждением, сервер работает в legacy-режиме);
/// 2) типовые относительные пути от рабочей директории сервера.
fn resolve_share_web_dir() -> Option<std::path::PathBuf> {
    use std::path::PathBuf;

    if let Ok(dir) = std::env::var("SHARE_WEB_DIR") {
        let path = PathBuf::from(dir);
        if path.join("index.html").is_file() {
            return Some(path);
        }
        tracing::warn!(
            path = %path.display(),
            "SHARE_WEB_DIR does not contain index.html; falling back to legacy /share behavior"
        );
        return None;
    }

    if let Ok(cwd) = std::env::current_dir() {
        for candidate in [
            "share-viewer-web/dist",
            "../share-viewer-web/dist",
            "backend/../share-viewer-web/dist",
        ] {
            let path = cwd.join(candidate);
            if path.join("index.html").is_file() {
                return Some(path);
            }
        }
    }
    None
}

fn optional_bool(name: &str, default: bool) -> Result<bool, String> {
    let Ok(value) = std::env::var(name) else {
        return Ok(default);
    };
    match value.trim().to_ascii_lowercase().as_str() {
        "true" | "1" => Ok(true),
        "false" | "0" => Ok(false),
        _ => Err(format!("{name} must be true or false")),
    }
}

fn is_placeholder_secret(secret: &str) -> bool {
    secret.starts_with("change_me_")
        || secret.starts_with("change_this_")
        || secret.starts_with("replace_with_")
}

fn required(name: &str) -> Result<String, String> {
    let value = std::env::var(name)
        .map_err(|_| format!("{name} is required"))?
        .trim()
        .to_string();
    if value.is_empty() {
        return Err(format!("{name} is required"));
    }
    Ok(value)
}
