mod auth_middleware;
mod protocol;
mod routes;
mod state;

use std::error::Error;

use tokio::net::TcpListener;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use backend::auth::AuthClient;
use backend::config::AppConfig;
use backend::db;
use backend::email::EmailClient;
use backend::storage::StorageClient;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error + Send + Sync>> {
    tracing_subscriber::registry()
        .with(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("backend=info,tower_http=info")),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = AppConfig::from_env()?;
    let address = config.socket_addr()?;
    let database = db::connect_lazy_from_config(&config.database)?;
    let auth = AuthClient::from_config(&config.auth);
    let email = EmailClient::from_config(&config.email);
    let storage = StorageClient::from_config(&config.object_storage).await;
    let app = routes::router(config.clone(), storage, database, auth, email);
    let listener = TcpListener::bind(address).await?;

    info!(%address, "backend listening");
    axum::serve(listener, app).await?;

    Ok(())
}
