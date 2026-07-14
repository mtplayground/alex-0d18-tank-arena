use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use tower_http::trace::TraceLayer;

use backend::config::AppConfig;

use crate::{
    protocol::{ErrorResponse, HealthResponse, RenderingStatus, RuntimeStatus},
    state::AppState,
};

pub fn router(config: AppConfig) -> Router {
    let state = AppState::new(config);

    Router::new()
        .route("/api/health", get(health))
        .route("/api/status", get(status))
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

async fn not_found() -> impl IntoResponse {
    (
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
            error: "route not found",
        }),
    )
}
