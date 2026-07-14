use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool};

use crate::auth::AuthClaims;

use super::{User, UserProfile};

#[derive(Clone, Debug)]
pub struct PlatformUserInput {
    pub sub: String,
    pub email: String,
    pub email_verified: bool,
    pub name: Option<String>,
    pub picture_url: Option<String>,
}

impl From<AuthClaims> for PlatformUserInput {
    fn from(claims: AuthClaims) -> Self {
        Self {
            sub: claims.sub,
            email: claims.email,
            email_verified: claims.email_verified,
            name: claims.name,
            picture_url: claims.picture,
        }
    }
}

#[derive(Clone, Debug)]
pub struct UserRegistration {
    pub user: User,
    pub registered: bool,
}

impl UserRegistration {
    pub fn profile(&self) -> UserProfile {
        UserProfile::from(&self.user)
    }
}

pub async fn upsert_platform_user(
    pool: &PgPool,
    input: PlatformUserInput,
) -> Result<UserRegistration, sqlx::Error> {
    let row = sqlx::query_as::<_, UpsertedUser>(
        r#"
        INSERT INTO users (sub, email, email_verified, name, picture_url)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (sub) DO UPDATE SET
            email = EXCLUDED.email,
            email_verified = EXCLUDED.email_verified,
            name = EXCLUDED.name,
            picture_url = EXCLUDED.picture_url,
            last_seen_at = NOW()
        RETURNING
            xmax = 0 AS registered,
            sub,
            email,
            email_verified,
            name,
            picture_url,
            password_hash,
            password_updated_at,
            created_at,
            updated_at,
            last_seen_at
        "#,
    )
    .bind(input.sub)
    .bind(input.email)
    .bind(input.email_verified)
    .bind(input.name)
    .bind(input.picture_url)
    .fetch_one(pool)
    .await?;

    Ok(row.into())
}

#[derive(FromRow)]
struct UpsertedUser {
    registered: bool,
    sub: String,
    email: String,
    email_verified: bool,
    name: Option<String>,
    picture_url: Option<String>,
    password_hash: Option<String>,
    password_updated_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    last_seen_at: DateTime<Utc>,
}

impl From<UpsertedUser> for UserRegistration {
    fn from(row: UpsertedUser) -> Self {
        Self {
            registered: row.registered,
            user: User {
                sub: row.sub,
                email: row.email,
                email_verified: row.email_verified,
                name: row.name,
                picture_url: row.picture_url,
                password_hash: row.password_hash,
                password_updated_at: row.password_updated_at,
                created_at: row.created_at,
                updated_at: row.updated_at,
                last_seen_at: row.last_seen_at,
            },
        }
    }
}
