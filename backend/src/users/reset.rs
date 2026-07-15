use argon2::password_hash::rand_core::{OsRng, RngCore};
use chrono::{DateTime, Duration, Utc};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgPool};
use thiserror::Error;

use super::password::{hash_password, PasswordError};

const RESET_TOKEN_BYTES: usize = 32;
const RESET_TOKEN_TTL_MINUTES: i64 = 60;

#[derive(Clone, Debug)]
pub struct PasswordResetToken {
    pub token: String,
    pub token_hash: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Clone, Debug)]
pub struct PasswordResetRequest {
    pub requested_email: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Error)]
pub enum PasswordResetError {
    #[error("password hashing failed: {0}")]
    Password(#[from] PasswordError),
    #[error("database operation failed: {0}")]
    Database(#[from] sqlx::Error),
}

pub fn new_password_reset_token() -> PasswordResetToken {
    let mut bytes = [0_u8; RESET_TOKEN_BYTES];
    OsRng.fill_bytes(&mut bytes);
    let token = hex_encode(&bytes);
    let token_hash = hash_reset_token(&token);
    let expires_at = Utc::now() + Duration::minutes(RESET_TOKEN_TTL_MINUTES);

    PasswordResetToken {
        token,
        token_hash,
        expires_at,
    }
}

pub async fn create_password_reset_request(
    pool: &PgPool,
    email: &str,
    token: &PasswordResetToken,
) -> Result<Option<PasswordResetRequest>, sqlx::Error> {
    sqlx::query_as::<_, PasswordResetRequestRow>(
        r#"
        WITH target_user AS (
            SELECT sub, email
            FROM users
            WHERE LOWER(email) = LOWER($1)
            ORDER BY last_seen_at DESC
            LIMIT 1
        ),
        inserted AS (
            INSERT INTO password_reset_tokens (
                user_sub,
                token_hash,
                requested_email,
                expires_at
            )
            SELECT sub, $2, email, $3
            FROM target_user
            RETURNING requested_email, expires_at
        )
        SELECT requested_email, expires_at
        FROM inserted
        "#,
    )
    .bind(email.trim())
    .bind(&token.token_hash)
    .bind(token.expires_at)
    .fetch_optional(pool)
    .await
    .map(|row| row.map(PasswordResetRequest::from))
}

pub async fn confirm_password_reset(
    pool: &PgPool,
    token: &str,
    new_password: &str,
) -> Result<bool, PasswordResetError> {
    let token_hash = hash_reset_token(token);
    let mut transaction = pool.begin().await?;

    let reset = sqlx::query_as::<_, ResetTokenUserRow>(
        r#"
        SELECT id::text AS id, user_sub
        FROM password_reset_tokens
        WHERE token_hash = $1
            AND consumed_at IS NULL
            AND expires_at > NOW()
        FOR UPDATE
        "#,
    )
    .bind(token_hash)
    .fetch_optional(&mut *transaction)
    .await?;

    let Some(reset) = reset else {
        transaction.rollback().await?;
        return Ok(false);
    };

    let password_hash = match hash_password(new_password) {
        Ok(password_hash) => password_hash,
        Err(error) => {
            transaction.rollback().await?;
            return Err(PasswordResetError::Password(error));
        }
    };

    sqlx::query(
        r#"
        UPDATE users
        SET password_hash = $1,
            password_updated_at = NOW()
        WHERE sub = $2
        "#,
    )
    .bind(password_hash)
    .bind(&reset.user_sub)
    .execute(&mut *transaction)
    .await?;

    sqlx::query(
        r#"
        UPDATE password_reset_tokens
        SET consumed_at = NOW()
        WHERE id = $1::uuid
        "#,
    )
    .bind(reset.id)
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;
    Ok(true)
}

fn hash_reset_token(token: &str) -> String {
    hex_encode(&Sha256::digest(token.as_bytes()))
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);

    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }

    encoded
}

#[derive(FromRow)]
struct PasswordResetRequestRow {
    requested_email: String,
    expires_at: DateTime<Utc>,
}

impl From<PasswordResetRequestRow> for PasswordResetRequest {
    fn from(row: PasswordResetRequestRow) -> Self {
        Self {
            requested_email: row.requested_email,
            expires_at: row.expires_at,
        }
    }
}

#[derive(FromRow)]
struct ResetTokenUserRow {
    id: String,
    user_sub: String,
}

#[cfg(test)]
mod tests {
    use super::{hash_reset_token, new_password_reset_token};

    #[test]
    fn generated_reset_tokens_are_hashable_and_distinct() {
        let first = new_password_reset_token();
        let second = new_password_reset_token();

        assert_eq!(first.token.len(), 64);
        assert_eq!(first.token_hash.len(), 64);
        assert_ne!(first.token, second.token);
        assert_eq!(first.token_hash, hash_reset_token(&first.token));
    }
}
