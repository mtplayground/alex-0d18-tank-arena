use std::{env, net::SocketAddr};

use thiserror::Error;

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub host: String,
    pub port: u16,
    pub version: &'static str,
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("PORT must be a valid TCP port: {0}")]
    InvalidPort(#[from] std::num::ParseIntError),
    #[error("HOST and PORT produced an invalid socket address: {0}")]
    InvalidSocketAddr(#[from] std::net::AddrParseError),
}

impl AppConfig {
    pub fn from_env() -> Result<Self, ConfigError> {
        let host = env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_owned());
        let port = env::var("PORT")
            .map(|value| value.parse::<u16>())
            .unwrap_or(Ok(8080))?;

        Ok(Self {
            host,
            port,
            version: env!("CARGO_PKG_VERSION"),
        })
    }

    pub fn socket_addr(&self) -> Result<SocketAddr, ConfigError> {
        format!("{}:{}", self.host, self.port)
            .parse::<SocketAddr>()
            .map_err(ConfigError::from)
    }
}
