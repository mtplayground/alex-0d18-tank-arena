use std::fmt;

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::FromRow;

#[derive(Clone, FromRow)]
pub struct User {
    pub sub: String,
    pub email: String,
    pub email_verified: bool,
    pub name: Option<String>,
    pub picture_url: Option<String>,
    pub password_hash: Option<String>,
    pub password_updated_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_seen_at: DateTime<Utc>,
}

impl User {
    pub fn has_password(&self) -> bool {
        self.password_hash.is_some()
    }
}

impl fmt::Debug for User {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("User")
            .field("sub", &self.sub)
            .field("email", &self.email)
            .field("email_verified", &self.email_verified)
            .field("name", &self.name)
            .field("picture_url", &self.picture_url)
            .field("password_hash", &self.password_hash.as_ref().map(|_| "[redacted]"))
            .field("password_updated_at", &self.password_updated_at)
            .field("created_at", &self.created_at)
            .field("updated_at", &self.updated_at)
            .field("last_seen_at", &self.last_seen_at)
            .finish()
    }
}

#[derive(Clone)]
pub struct NewUser {
    pub sub: String,
    pub email: String,
    pub email_verified: bool,
    pub name: Option<String>,
    pub picture_url: Option<String>,
    pub password_hash: Option<String>,
}

impl fmt::Debug for NewUser {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("NewUser")
            .field("sub", &self.sub)
            .field("email", &self.email)
            .field("email_verified", &self.email_verified)
            .field("name", &self.name)
            .field("picture_url", &self.picture_url)
            .field("password_hash", &self.password_hash.as_ref().map(|_| "[redacted]"))
            .finish()
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct UserProfile {
    pub sub: String,
    pub email: String,
    pub email_verified: bool,
    pub name: Option<String>,
    pub picture_url: Option<String>,
    pub has_password: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_seen_at: DateTime<Utc>,
}

impl From<&User> for UserProfile {
    fn from(user: &User) -> Self {
        Self {
            sub: user.sub.clone(),
            email: user.email.clone(),
            email_verified: user.email_verified,
            name: user.name.clone(),
            picture_url: user.picture_url.clone(),
            has_password: user.has_password(),
            created_at: user.created_at,
            updated_at: user.updated_at,
            last_seen_at: user.last_seen_at,
        }
    }
}
