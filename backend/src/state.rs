use backend::config::AppConfig;
use backend::storage::StorageClient;

#[derive(Clone, Debug)]
pub struct AppState {
    pub config: AppConfig,
    pub storage: StorageClient,
}

impl AppState {
    pub fn new(config: AppConfig, storage: StorageClient) -> Self {
        Self { config, storage }
    }
}
