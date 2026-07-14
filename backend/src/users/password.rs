use argon2::{
    password_hash::{
        rand_core::OsRng, Error as PasswordHashLibError, PasswordHash, PasswordHasher,
        PasswordVerifier, SaltString,
    },
    Algorithm, Argon2, Params, Version,
};
use thiserror::Error;

const MAX_PASSWORD_BYTES: usize = 1024;
const ARGON2_MEMORY_COST_KIB: u32 = 19_456;
const ARGON2_TIME_COST: u32 = 2;
const ARGON2_PARALLELISM: u32 = 1;

#[derive(Debug, Error)]
pub enum PasswordError {
    #[error("password must not be empty")]
    EmptyPassword,
    #[error("password must be at most {MAX_PASSWORD_BYTES} bytes")]
    PasswordTooLong,
    #[error("password hashing parameters are invalid: {0}")]
    InvalidParams(String),
    #[error("password hashing failed: {0}")]
    Hash(#[source] PasswordHashLibError),
    #[error("stored password hash is invalid: {0}")]
    InvalidHash(#[source] PasswordHashLibError),
    #[error("password verification failed: {0}")]
    Verify(#[source] PasswordHashLibError),
}

pub fn hash_password(password: &str) -> Result<String, PasswordError> {
    validate_password(password)?;

    let salt = SaltString::generate(&mut OsRng);
    let hash = argon2id()?
        .hash_password(password.as_bytes(), &salt)
        .map_err(PasswordError::Hash)?
        .to_string();

    Ok(hash)
}

pub fn verify_password(password: &str, stored_hash: &str) -> Result<bool, PasswordError> {
    validate_password(password)?;

    let parsed_hash = PasswordHash::new(stored_hash).map_err(PasswordError::InvalidHash)?;

    match argon2id()?.verify_password(password.as_bytes(), &parsed_hash) {
        Ok(()) => Ok(true),
        Err(PasswordHashLibError::Password) => Ok(false),
        Err(error) => Err(PasswordError::Verify(error)),
    }
}

fn validate_password(password: &str) -> Result<(), PasswordError> {
    if password.is_empty() {
        return Err(PasswordError::EmptyPassword);
    }

    if password.len() > MAX_PASSWORD_BYTES {
        return Err(PasswordError::PasswordTooLong);
    }

    Ok(())
}

fn argon2id() -> Result<Argon2<'static>, PasswordError> {
    let params = Params::new(
        ARGON2_MEMORY_COST_KIB,
        ARGON2_TIME_COST,
        ARGON2_PARALLELISM,
        None,
    )
    .map_err(|error| PasswordError::InvalidParams(error.to_string()))?;

    Ok(Argon2::new(Algorithm::Argon2id, Version::V0x13, params))
}

#[cfg(test)]
mod tests {
    use super::{hash_password, verify_password, PasswordError};

    #[test]
    fn verifies_hashed_password() -> Result<(), PasswordError> {
        let hash = hash_password("correct horse battery staple")?;

        assert!(verify_password("correct horse battery staple", &hash)?);
        assert!(!verify_password("wrong horse battery staple", &hash)?);
        assert!(hash.starts_with("$argon2id$"));

        Ok(())
    }

    #[test]
    fn rejects_empty_passwords() {
        assert!(matches!(hash_password(""), Err(PasswordError::EmptyPassword)));
        assert!(matches!(
            verify_password("", "$argon2id$v=19$m=19456,t=2,p=1$bad$bad"),
            Err(PasswordError::EmptyPassword)
        ));
    }
}
