use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Redirect},
    routing::get,
    Json, Router,
};
use tower_http::trace::TraceLayer;
use tracing::error;

use backend::config::AppConfig;
use backend::storage::{AssetDefinition, StorageClient, StorageError, GAME_ASSETS};

use crate::{
    protocol::{
        AssetManifestResponse, AssetResponse, ErrorResponse, HealthResponse, RenderingStatus,
        RuntimeStatus,
    },
    state::AppState,
};

pub fn router(config: AppConfig, storage: StorageClient) -> Router {
    let state = AppState::new(config, storage);

    Router::new()
        .route("/api/health", get(health))
        .route("/api/status", get(status))
        .route("/api/assets/manifest", get(asset_manifest))
        .route("/api/assets/:category/:asset_id", get(asset_redirect))
        .fallback(not_found)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        ok: true,
        service: "backend",
        version: state.config.version,
    })
}

async fn status() -> Json<RuntimeStatus> {
    Json(RuntimeStatus {
        api_base_url: "/api",
        rendering: RenderingStatus {
            engine: "three-js",
            react_renderer: "@react-three/fiber",
        },
    })
}

async fn asset_manifest(
    State(state): State<AppState>,
) -> Result<Json<AssetManifestResponse>, AssetRouteError> {
    let mut assets = Vec::with_capacity(GAME_ASSETS.len());

    for asset in GAME_ASSETS {
        let url = state.storage.presigned_get_url(asset.relative_key).await?;
        assets.push(AssetResponse {
            id: asset.id,
            category: asset.category,
            label: asset.label,
            content_type: asset.content_type,
            url,
        });
    }

    Ok(Json(AssetManifestResponse {
        assets,
        expires_in_seconds: state.storage.presign_expires_in_seconds(),
    }))
}

async fn asset_redirect(
    State(state): State<AppState>,
    Path((category, asset_id)): Path<(String, String)>,
) -> Result<Redirect, AssetRouteError> {
    let asset =
        find_asset(&category, &asset_id).ok_or(AssetRouteError::NotFound)?;
    let url = state.storage.presigned_get_url(asset.relative_key).await?;

    Ok(Redirect::temporary(&url))
}

async fn not_found() -> impl IntoResponse {
    (
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
            error: "route not found",
        }),
    )
}

fn find_asset(category: &str, asset_id: &str) -> Option<&'static AssetDefinition> {
    GAME_ASSETS
        .iter()
        .find(|asset| asset.category == category && asset.id == asset_id)
}

#[derive(Debug)]
enum AssetRouteError {
    NotFound,
    Storage(StorageError),
}

impl From<StorageError> for AssetRouteError {
    fn from(error: StorageError) -> Self {
        Self::Storage(error)
    }
}

impl IntoResponse for AssetRouteError {
    fn into_response(self) -> axum::response::Response {
        match self {
            Self::NotFound => (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "asset not found",
                }),
            )
                .into_response(),
            Self::Storage(error) => {
                error!(?error, "failed to sign asset url");
                (
                    StatusCode::BAD_GATEWAY,
                    Json(ErrorResponse {
                        error: "asset url unavailable",
                    }),
                )
                    .into_response()
            }
        }
    }
}
