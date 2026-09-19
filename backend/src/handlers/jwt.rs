use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};

use crate::handlers::auth::now_secs;

/// Срок жизни access-JWT (как было: 24ч). Проверяется подписью и `exp`
/// при каждом обращении (`require_session`). Десктоп-клиент продлевает его
/// при старте и раз в несколько часов через /auth/refresh, поэтому короткий
/// TTL незаметен для пользователя.
pub const ACCESS_TOKEN_TTL_SECS: u64 = 86_400;

/// Срок жизни сессии в БД — "окно" для /auth/refresh. Это refresh-токен:
/// пока строка сессии жива, /auth/refresh выдаёт новый access-JWT даже если
/// старый уже просрочен. Десктоп-клиент хранит токен в безопасном хранилище
/// ОС, поэтому долгое окно оправдано — пользователь не должен входить заново,
/// если открывает приложение хотя бы раз в 30 дней.
pub const SESSION_TTL_SECS: u64 = 30 * 24 * 60 * 60;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String, // username
    pub role: String,
    pub display_name: String,
    pub device: String,
    pub iat: u64,
    pub exp: u64,
}

/// Создаёт подписанный JWT для пользователя. Возвращает (token, expires_at).
pub fn issue_token(
    secret: &str,
    username: &str,
    role: &str,
    display_name: &str,
    device: &str,
) -> (String, u64) {
    let now = now_secs();
    let exp = now + ACCESS_TOKEN_TTL_SECS;

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
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .expect("JWT encoding should not fail");

    (token, exp)
}

/// Проверяет подпись и срок действия токена, возвращает claims если валиден.
pub fn verify_token(secret: &str, token: &str) -> Option<Claims> {
    let mut validation = Validation::default();
    // Require the `sub` claim: a crafted token without a subject must not
    // pass validation (defense-in-depth on top of signature verification).
    validation.set_required_spec_claims(&["exp", "sub"]);
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .ok()?;
    Some(data.claims)
}
