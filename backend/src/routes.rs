use axum::{
    extract::{Path, State},
    http::{header::HOST, HeaderMap, HeaderName, StatusCode},
    response::{IntoResponse, Redirect},
    routing::get,
    Json, Router,
};
use sqlx::PgPool;
use tower_http::trace::TraceLayer;
use tracing::error;

use backend::auth::{AuthClient, AuthError};
use backend::config::AppConfig;
use backend::storage::{AssetDefinition, StorageClient, StorageError, GAME_ASSETS};
use backend::users::{upsert_platform_user, PlatformUserInput};

use crate::{
    protocol::{
        AssetManifestResponse, AssetResponse, AuthSessionResponse, ErrorResponse, HealthResponse,
        RenderingStatus, RuntimeStatus,
    },
    state::AppState,
};

pub fn router(
    config: AppConfig,
    storage: StorageClient,
    database: PgPool,
    auth: AuthClient,
) -> Router {
    let state = AppState::new(config, storage, database, auth);

    Router::new()
        .route("/api/health", get(health))
        .route("/api/status", get(status))
        .route("/api/auth/login", get(auth_redirect).post(auth_redirect))
        .route("/api/auth/register", get(auth_redirect).post(auth_redirect))
        .route("/api/auth/me", get(auth_me))
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

async fn auth_redirect(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Redirect, AuthRouteError> {
    let return_to = frontend_return_to(&headers, &state.config);
    let login_url = state.auth.login_url(&return_to);

    Ok(Redirect::temporary(&login_url))
}

async fn auth_me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<AuthSessionResponse>, AuthRouteError> {
    let claims = state.auth.verify_headers(&headers).await?;
    let registration =
        upsert_platform_user(&state.database, PlatformUserInput::from(claims)).await?;
    let profile = registration.profile();
    let display_name = profile.name.clone().unwrap_or_else(|| profile.email.clone());
    let message = if registration.registered {
        "Registration complete!".to_owned()
    } else {
        format!("Welcome back, {display_name}!")
    };

    Ok(Json(AuthSessionResponse {
        user: profile,
        registered: registration.registered,
        message,
    }))
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
    let asset = find_asset(&category, &asset_id).ok_or(AssetRouteError::NotFound)?;
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

fn frontend_return_to(headers: &HeaderMap, config: &AppConfig) -> String {
    if let Some(self_url) = &config.server.self_url {
        return root_url(self_url);
    }

    let forwarded_proto = HeaderName::from_static("x-forwarded-proto");
    let forwarded_host = HeaderName::from_static("x-forwarded-host");
    let proto = headers
        .get(&forwarded_proto)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("http");
    let host = headers
        .get(&forwarded_host)
        .or_else(|| headers.get(HOST))
        .and_then(|value| value.to_str().ok())
        .unwrap_or("localhost:5173");

    format!("{proto}://{host}/")
}

fn root_url(base_url: &str) -> String {
    format!("{}/", base_url.trim_end_matches('/'))
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

#[derive(Debug)]
enum AuthRouteError {
    Auth(AuthError),
    Database(sqlx::Error),
}

impl From<AuthError> for AuthRouteError {
    fn from(error: AuthError) -> Self {
        Self::Auth(error)
    }
}

impl From<sqlx::Error> for AuthRouteError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}

impl IntoResponse for AuthRouteError {
    fn into_response(self) -> axum::response::Response {
        match self {
            Self::Auth(AuthError::MissingSession) => (
                StatusCode::UNAUTHORIZED,
                Json(ErrorResponse {
                    error: "not authenticated",
                }),
            )
                .into_response(),
            Self::Auth(error) => {
                error!(?error, "failed to verify auth session");
                (
                    StatusCode::UNAUTHORIZED,
                    Json(ErrorResponse {
                        error: "invalid session",
                    }),
                )
                    .into_response()
            }
            Self::Database(error) => {
                error!(?error, "failed to upsert authenticated user");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: "user persistence failed",
                    }),
                )
                    .into_response()
            }
        }
    }
}
