#[derive(Clone, Debug)]
pub struct User {
    pub username: String,
    pub password_hash: String,
    pub display_name: String,
    pub role: String,
}
