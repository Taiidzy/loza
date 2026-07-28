use serde::{Serialize};

pub const ROLE_ADMIN: &str = "admin";
#[derive(Clone, Debug, Serialize)]
pub struct User {
    pub username: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub display_name: String,
    pub role: String,
    pub quota_bytes: Option<u64>,
}
