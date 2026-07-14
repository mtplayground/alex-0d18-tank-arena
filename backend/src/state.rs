use backend::auth::AuthClient;
use backend::config::AppConfig;
use backend::storage::StorageClient;
use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub config: AppConfig,
    pub storage: StorageClient,
    pub database: PgPool,
    pub auth: AuthClient,
}

impl AppState {
    pub fn new(
        config: AppConfig,
        storage: StorageClient,
        database: PgPool,
        auth: AuthClient,
    ) -> Self {
        Self {
            config,
            storage,
            database,
            auth,
        }
    }
}
