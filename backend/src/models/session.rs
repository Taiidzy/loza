/// Сессия пользователя.
///
/// `device` передаётся клиентом при логине (например, "macOS · Loza Desktop")
/// и используется как есть в карточке "Клиенты" на дашборде.
/// `last_seen` обновляется при каждом обращении с валидным токеном (см. handlers::status,
/// handlers::auth::me) и определяет, считается ли клиент "активным".
#[derive(Clone, Debug)]
pub struct Session {
    pub token: String,
    pub username: String,
    pub device: String,
    pub created_at: u64,
    pub last_seen: u64,
    pub expires_at: u64,
}
