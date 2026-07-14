use std::{env, fmt, net::SocketAddr, path::Path};

use thiserror::Error;

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub auth: AuthConfig,
    pub object_storage: ObjectStorageConfig,
    pub email: EmailConfig,
    pub version: &'static str,
}

#[derive(Clone, Debug)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub self_url: Option<String>,
    pub allowed_cors_origin: Option<String>,
}

#[derive(Clone, Debug)]
pub struct DatabaseConfig {
    pub url: SecretString,
}

#[derive(Clone, Debug)]
pub struct AuthConfig {
    pub mctai_auth_url: String,
    pub mctai_auth_app_token: SecretString,
    pub mctai_auth_jwks_url: String,
    pub jwt_secret: SecretString,
}

#[derive(Clone, Debug)]
pub struct ObjectStorageConfig {
    pub access_key_id: SecretString,
    pub secret_access_key: SecretString,
    pub bucket: String,
    pub prefix: String,
    pub endpoint: String,
    pub region: String,
    pub force_path_style: bool,
}

#[derive(Clone, Debug)]
pub enum EmailConfig {
    Enabled {
        url: String,
        app_token: SecretString,
    },
    Disabled,
}

#[derive(Clone, Eq, PartialEq)]
pub struct SecretString(String);

impl SecretString {
    pub fn new(value: String) -> Self {
        Self(value)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for SecretString {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("[redacted]")
    }
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("failed to load environment file: {0}")]
    Dotenv(#[from] dotenvy::Error),
    #[error("{key} environment variable is required")]
    MissingEnv { key: &'static str },
    #[error("{key} environment variable must not be empty")]
    EmptyEnv { key: &'static str },
    #[error("PORT must be a valid TCP port: {0}")]
    InvalidPort(#[from] std::num::ParseIntError),
    #[error("{key} must be a boolean value, got {value:?}")]
    InvalidBool { key: &'static str, value: String },
    #[error("HOST and PORT produced an invalid socket address: {0}")]
    InvalidSocketAddr(#[from] std::net::AddrParseError),
    #[error("email configuration is incomplete; set both MCTAI_EMAIL_URL and MCTAI_EMAIL_APP_TOKEN or neither")]
    IncompleteEmailConfig,
}

impl AppConfig {
    pub fn from_env() -> Result<Self, ConfigError> {
        load_environment_files()?;

        let host = env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_owned());
        let port = env::var("PORT")
            .map(|value| value.parse::<u16>())
            .unwrap_or(Ok(8080))?;
        let server = ServerConfig {
            host,
            port,
            self_url: optional_env("SELF_URL")?,
            allowed_cors_origin: optional_env("ALLOWED_CORS_ORIGIN")?,
        };
        let database = DatabaseConfig {
            url: required_secret("DATABASE_URL")?,
        };
        let auth = AuthConfig {
            mctai_auth_url: required_env("MCTAI_AUTH_URL")?,
            mctai_auth_app_token: required_secret("MCTAI_AUTH_APP_TOKEN")?,
            mctai_auth_jwks_url: required_env("MCTAI_AUTH_JWKS_URL")?,
            jwt_secret: required_secret("JWT_SECRET")?,
        };
        let object_storage = ObjectStorageConfig {
            access_key_id: required_secret("OBJECT_STORAGE_ACCESS_KEY_ID")?,
            secret_access_key: required_secret("OBJECT_STORAGE_SECRET_ACCESS_KEY")?,
            bucket: required_env("OBJECT_STORAGE_BUCKET")?,
            prefix: required_env("OBJECT_STORAGE_PREFIX")?,
            endpoint: required_env("OBJECT_STORAGE_ENDPOINT")?,
            region: required_env("OBJECT_STORAGE_REGION")?,
            force_path_style: required_bool("OBJECT_STORAGE_FORCE_PATH_STYLE")?,
        };
        let email = email_config()?;

        Ok(Self {
            server,
            database,
            auth,
            object_storage,
            email,
            version: env!("CARGO_PKG_VERSION"),
        })
    }

    pub fn socket_addr(&self) -> Result<SocketAddr, ConfigError> {
        format!("{}:{}", self.server.host, self.server.port)
            .parse::<SocketAddr>()
            .map_err(ConfigError::from)
    }
}

fn load_environment_files() -> Result<(), ConfigError> {
    if Path::new(".env").exists() {
        dotenvy::from_filename(".env")?;
    }

    if let Ok(path) = env::var("APP_ENV_FILE") {
        if path.is_empty() {
            return Err(ConfigError::EmptyEnv {
                key: "APP_ENV_FILE",
            });
        }
        dotenvy::from_filename(path)?;
    }

    Ok(())
}

fn required_env(key: &'static str) -> Result<String, ConfigError> {
    let value = env::var(key).map_err(|_| ConfigError::MissingEnv { key })?;

    if value.is_empty() {
        return Err(ConfigError::EmptyEnv { key });
    }

    Ok(value)
}

fn required_secret(key: &'static str) -> Result<SecretString, ConfigError> {
    required_env(key).map(SecretString::new)
}

fn optional_env(key: &'static str) -> Result<Option<String>, ConfigError> {
    match env::var(key) {
        Ok(value) if value.is_empty() => Err(ConfigError::EmptyEnv { key }),
        Ok(value) => Ok(Some(value)),
        Err(env::VarError::NotPresent) => Ok(None),
        Err(env::VarError::NotUnicode(_)) => Err(ConfigError::MissingEnv { key }),
    }
}

fn required_bool(key: &'static str) -> Result<bool, ConfigError> {
    let value = required_env(key)?;

    match value.to_ascii_lowercase().as_str() {
        "true" | "1" | "yes" | "on" => Ok(true),
        "false" | "0" | "no" | "off" => Ok(false),
        _ => Err(ConfigError::InvalidBool { key, value }),
    }
}

fn email_config() -> Result<EmailConfig, ConfigError> {
    let url = optional_env_allow_empty("MCTAI_EMAIL_URL");
    let app_token = optional_env_allow_empty("MCTAI_EMAIL_APP_TOKEN");

    match (url, app_token) {
        (Some(url), Some(app_token)) => Ok(EmailConfig::Enabled {
            url,
            app_token: SecretString::new(app_token),
        }),
        (None, None) => Ok(EmailConfig::Disabled),
        _ => Err(ConfigError::IncompleteEmailConfig),
    }
}

fn optional_env_allow_empty(key: &'static str) -> Option<String> {
    match env::var(key) {
        Ok(value) if value.is_empty() => None,
        Ok(value) => Some(value),
        Err(_) => None,
    }
}
