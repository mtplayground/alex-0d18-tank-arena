use backend::auth::AuthClient;
use backend::config::AppConfig;
use backend::email::EmailClient;
use backend::match_sessions::MatchSessionRegistry;
use backend::storage::StorageClient;
use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub config: AppConfig,
    pub storage: StorageClient,
    pub database: PgPool,
    pub auth: AuthClient,
    pub email: EmailClient,
    pub match_sessions: MatchSessionRegistry,
}

impl AppState {
    pub fn new(
        config: AppConfig,
        storage: StorageClient,
        database: PgPool,
        auth: AuthClient,
        email: EmailClient,
    ) -> Self {
        Self {
            config,
            storage,
            database,
            auth,
            email,
            match_sessions: MatchSessionRegistry::new(),
        }
    }
}
