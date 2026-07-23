use serde::{Deserialize, Serialize};

pub const ROLE_ADMIN: &str = "admin";
pub const ROLE_USER: &str = "user";
#[derive(Clone, Debug, Serialize)]
pub struct User {
    pub username: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub display_name: String,
    pub role: String,
    pub quota_bytes: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct PublicUser {
    pub username: String,
    pub display_name: String,
    pub role: String,
    pub quota_bytes: Option<u64>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    pub password: String,
    pub display_name: Option<String>,
    pub role: Option<String>,
    pub quota_bytes: Option<u64>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: Option<String>,
    pub new_password: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct UpdateQuotaRequest {
    pub quota_bytes: Option<u64>,
}

impl User {
    pub fn public(&self) -> PublicUser {
        PublicUser {
            username: self.username.clone(),
            display_name: self.display_name.clone(),
            role: self.role.clone(),
            quota_bytes: self.quota_bytes,
        }
    }
}
