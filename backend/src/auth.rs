use axum::http::{header::COOKIE, HeaderMap};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use thiserror::Error;

use crate::config::AuthConfig;

const SESSION_COOKIE_NAME: &str = "mctai_session";

#[derive(Clone)]
pub struct AuthClient {
    auth_url: String,
    app_token: String,
    jwks_url: String,
    http: reqwest::Client,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AuthClaims {
    pub sub: String,
    pub email: String,
    #[serde(default)]
    pub email_verified: bool,
    pub name: Option<String>,
    pub picture: Option<String>,
}

#[derive(Debug, Error)]
pub enum AuthError {
    #[error("mctai_session cookie is missing")]
    MissingSession,
    #[error("session token header is missing kid")]
    MissingKeyId,
    #[error("session signing key was not found")]
    SigningKeyNotFound,
    #[error("failed to read session token header: {0}")]
    TokenHeader(String),
    #[error("failed to fetch auth JWKS: {0}")]
    JwksFetch(String),
    #[error("invalid signing key: {0}")]
    SigningKey(String),
    #[error("session token verification failed: {0}")]
    TokenVerification(String),
}

impl AuthClient {
    pub fn from_config(config: &AuthConfig) -> Self {
        Self {
            auth_url: config.mctai_auth_url.trim_end_matches('/').to_owned(),
            app_token: config.mctai_auth_app_token.as_str().to_owned(),
            jwks_url: config.mctai_auth_jwks_url.clone(),
            http: reqwest::Client::new(),
        }
    }

    pub fn login_url(&self, return_to: &str) -> String {
        format!(
            "{}/login?app_token={}&return_to={}",
            self.auth_url,
            urlencoding::encode(&self.app_token),
            urlencoding::encode(return_to)
        )
    }

    pub async fn verify_headers(&self, headers: &HeaderMap) -> Result<AuthClaims, AuthError> {
        let token = session_cookie(headers).ok_or(AuthError::MissingSession)?;
        self.verify_session_token(token).await
    }

    async fn verify_session_token(&self, token: &str) -> Result<AuthClaims, AuthError> {
        let header =
            decode_header(token).map_err(|error| AuthError::TokenHeader(error.to_string()))?;
        let key_id = header.kid.ok_or(AuthError::MissingKeyId)?;
        let jwks = self.fetch_jwks().await?;
        let jwk = jwks
            .keys
            .into_iter()
            .find(|key| key.kid.as_deref() == Some(key_id.as_str()))
            .ok_or(AuthError::SigningKeyNotFound)?;
        let decoding_key = DecodingKey::from_rsa_components(&jwk.n, &jwk.e)
            .map_err(|error| AuthError::SigningKey(error.to_string()))?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_audience(&[self.app_token.as_str()]);
        validation.set_issuer(&[self.auth_url.as_str()]);

        decode::<AuthClaims>(token, &decoding_key, &validation)
            .map(|token| token.claims)
            .map_err(|error| AuthError::TokenVerification(error.to_string()))
    }

    async fn fetch_jwks(&self) -> Result<Jwks, AuthError> {
        let response = self
            .http
            .get(&self.jwks_url)
            .send()
            .await
            .map_err(|error| AuthError::JwksFetch(error.to_string()))?;

        response
            .error_for_status()
            .map_err(|error| AuthError::JwksFetch(error.to_string()))?
            .json::<Jwks>()
            .await
            .map_err(|error| AuthError::JwksFetch(error.to_string()))
    }
}

fn session_cookie(headers: &HeaderMap) -> Option<&str> {
    let cookie_header = headers.get(COOKIE)?.to_str().ok()?;

    cookie_header.split(';').find_map(|cookie| {
        let (name, value) = cookie.trim().split_once('=')?;
        (name == SESSION_COOKIE_NAME && !value.is_empty()).then_some(value)
    })
}

#[derive(Debug, Deserialize)]
struct Jwks {
    keys: Vec<Jwk>,
}

#[derive(Debug, Deserialize)]
struct Jwk {
    kid: Option<String>,
    n: String,
    e: String,
}
