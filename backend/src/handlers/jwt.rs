use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};

use crate::handlers::auth::now_secs;

/// Время жизни токена — как было в исходной сессии (24ч).
/// Tauri-слой сам продлевает токен при каждом запуске приложения через /auth/refresh,
/// поэтому реальный "срок жизни без активности" не ограничен для пользователя,
/// пока он открывает приложение хотя бы раз в 24ч.
pub const TOKEN_TTL_SECS: u64 = 86_400;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String, // username
    pub role: String,
    pub display_name: String,
    pub device: String,
    pub iat: u64,
    pub exp: u64,
}

fn secret() -> String {
    std::env::var("JWT_SECRET")
        .unwrap_or_else(|_| {
            tracing::warn!(
                "JWT_SECRET не задан; используется dev-secret. Для production задайте длинный случайный JWT_SECRET"
            );
            "change_this_to_a_long_random_secret_in_production".to_string()
        })
}

/// Создаёт подписанный JWT для пользователя. Возвращает (token, expires_at).
pub fn issue_token(username: &str, role: &str, display_name: &str, device: &str) -> (String, u64) {
    let now = now_secs();
    let exp = now + TOKEN_TTL_SECS;

    let claims = Claims {
        sub: username.to_string(),
        role: role.to_string(),
        display_name: display_name.to_string(),
        device: device.to_string(),
        iat: now,
        exp,
    };

    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret().as_bytes()),
    )
    .expect("JWT encoding should not fail");

    (token, exp)
}

/// Проверяет подпись и срок действия токена, возвращает claims если валиден.
pub fn verify_token(token: &str) -> Option<Claims> {
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret().as_bytes()),
        &Validation::default(),
    )
    .ok()?;
    Some(data.claims)
}
