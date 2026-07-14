use std::time::Duration;

use sqlx::{postgres::PgPoolOptions, PgPool};
use thiserror::Error;

use crate::config::DatabaseConfig;

const DEFAULT_MAX_CONNECTIONS: u32 = 5;
const DEFAULT_ACQUIRE_TIMEOUT_SECONDS: u64 = 10;

#[derive(Debug, Error)]
pub enum DatabaseError {
    #[error("DATABASE_URL environment variable is required")]
    MissingDatabaseUrl,
    #[error("database connection failed: {0}")]
    Connect(#[from] sqlx::Error),
    #[error("database migration failed: {0}")]
    Migrate(#[from] sqlx::migrate::MigrateError),
}

pub async fn connect_from_env() -> Result<PgPool, DatabaseError> {
    let database_url =
        std::env::var("DATABASE_URL").map_err(|_| DatabaseError::MissingDatabaseUrl)?;

    connect(&database_url).await
}

pub async fn connect_from_config(config: &DatabaseConfig) -> Result<PgPool, DatabaseError> {
    connect(config.url.as_str()).await
}

pub fn connect_lazy_from_config(config: &DatabaseConfig) -> Result<PgPool, DatabaseError> {
    PgPoolOptions::new()
        .max_connections(DEFAULT_MAX_CONNECTIONS)
        .acquire_timeout(Duration::from_secs(DEFAULT_ACQUIRE_TIMEOUT_SECONDS))
        .connect_lazy(config.url.as_str())
        .map_err(DatabaseError::from)
}

pub async fn connect(database_url: &str) -> Result<PgPool, DatabaseError> {
    PgPoolOptions::new()
        .max_connections(DEFAULT_MAX_CONNECTIONS)
        .acquire_timeout(Duration::from_secs(DEFAULT_ACQUIRE_TIMEOUT_SECONDS))
        .connect(database_url)
        .await
        .map_err(DatabaseError::from)
}

pub async fn run_migrations(pool: &PgPool) -> Result<(), DatabaseError> {
    sqlx::migrate!("../migrations")
        .run(pool)
        .await
        .map_err(DatabaseError::from)
}
