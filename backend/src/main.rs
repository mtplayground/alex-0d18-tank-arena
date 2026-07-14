mod config;
mod protocol;
mod routes;
mod state;

use std::error::Error;

use tokio::net::TcpListener;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use crate::config::AppConfig;

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
    let app = routes::router(config.clone());
    let listener = TcpListener::bind(address).await?;

    info!(%address, "backend listening");
    axum::serve(listener, app).await?;

    Ok(())
}
