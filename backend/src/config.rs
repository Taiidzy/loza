#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub port: u16,
    pub trust_proxy_headers: bool,
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

        Ok(Self {
            database_url,
            jwt_secret,
            port,
            trust_proxy_headers,
        })
    }
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
