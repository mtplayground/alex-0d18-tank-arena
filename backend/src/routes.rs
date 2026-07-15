use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    http::{header::HOST, HeaderMap, HeaderName, StatusCode},
    middleware::from_fn_with_state,
    response::{IntoResponse, Redirect},
    routing::{get, put},
    Extension, Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use sqlx::PgPool;
use tower_http::trace::TraceLayer;
use tracing::{error, info};

use backend::auth::AuthClient;
use backend::config::AppConfig;
use backend::email::{EmailClient, EmailError};
use backend::match_sessions::{
    validate_match_id, MatchSessionError, MatchSessionRegistry, MatchSessionSubscription,
};
use backend::matchmaking::MatchmakingError;
use backend::mission_progress::{
    list_mission_progress, upsert_mission_progress, MissionProgressError,
};
use backend::storage::{AssetDefinition, StorageClient, StorageError, GAME_ASSETS};
use backend::users::{
    confirm_password_reset, create_password_reset_request, new_password_reset_token,
    PasswordError, PasswordResetError,
};

use crate::{
    auth_middleware::{require_auth, AuthenticatedUser},
    protocol::{
        AssetManifestResponse, AssetResponse, AuthSessionResponse, ErrorResponse, HealthResponse,
        MatchmakingJoinPayload, MatchmakingQueueResponse, MessageResponse,
        MissionProgressListResponse, MissionProgressUpdatePayload, MissionProgressUpdateResponse,
        PasswordResetConfirmPayload, PasswordResetRequestPayload, RenderingStatus, RuntimeStatus,
    },
    state::AppState,
};

pub fn router(
    config: AppConfig,
    storage: StorageClient,
    database: PgPool,
    auth: AuthClient,
    email: EmailClient,
) -> Router {
    let state = AppState::new(config, storage, database, auth, email);
    let protected_routes = Router::new()
        .route("/api/auth/me", get(auth_me))
        .route(
            "/api/matchmaking/queue",
            get(matchmaking_status)
                .post(matchmaking_join)
                .delete(matchmaking_cancel),
        )
        .route("/api/mission-progress", get(mission_progress_list))
        .route(
            "/api/mission-progress/:mission_key",
            put(mission_progress_upsert),
        )
        .route("/api/ws/matches/:match_id", get(match_socket))
        .route_layer(from_fn_with_state(state.clone(), require_auth));

    Router::new()
        .route("/api/health", get(health))
        .route("/api/status", get(status))
        .route("/api/auth/login", get(auth_redirect).post(auth_redirect))
        .route("/api/auth/register", get(auth_redirect).post(auth_redirect))
        .route(
            "/api/auth/password-reset/request",
            get(method_not_allowed).post(password_reset_request),
        )
        .route(
            "/api/auth/password-reset/confirm",
            get(method_not_allowed).post(password_reset_confirm),
        )
        .route("/api/assets/manifest", get(asset_manifest))
        .route("/api/assets/:category/:asset_id", get(asset_redirect))
        .merge(protected_routes)
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

async fn auth_redirect(State(state): State<AppState>, headers: HeaderMap) -> Redirect {
    let return_to = frontend_return_to(&headers, &state.config);
    let login_url = state.auth.login_url(&return_to);

    Redirect::temporary(&login_url)
}

async fn auth_me(Extension(user): Extension<AuthenticatedUser>) -> Json<AuthSessionResponse> {
    let profile = user.profile;
    let display_name = profile.name.clone().unwrap_or_else(|| profile.email.clone());
    let message = if user.registered {
        "Registration complete!".to_owned()
    } else {
        format!("Welcome back, {display_name}!")
    };

    Json(AuthSessionResponse {
        user: profile,
        registered: user.registered,
        message,
    })
}

async fn matchmaking_status(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Json<MatchmakingQueueResponse> {
    Json(state.matchmaking.status(&user.profile.sub).await)
}

async fn matchmaking_join(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(payload): Json<MatchmakingJoinPayload>,
) -> Result<Json<MatchmakingQueueResponse>, MatchmakingRouteError> {
    let response = state
        .matchmaking
        .join(&state.database, &user.profile.sub, payload)
        .await?;

    Ok(Json(response))
}

async fn matchmaking_cancel(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Json<MatchmakingQueueResponse> {
    Json(state.matchmaking.cancel(&user.profile.sub).await)
}

async fn mission_progress_list(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<MissionProgressListResponse>, MissionProgressRouteError> {
    let missions = list_mission_progress(&state.database, &user.profile.sub).await?;

    Ok(Json(MissionProgressListResponse { missions }))
}

async fn mission_progress_upsert(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(mission_key): Path<String>,
    Json(payload): Json<MissionProgressUpdatePayload>,
) -> Result<Json<MissionProgressUpdateResponse>, MissionProgressRouteError> {
    let mission =
        upsert_mission_progress(&state.database, &user.profile.sub, &mission_key, payload).await?;

    Ok(Json(MissionProgressUpdateResponse { mission }))
}

async fn match_socket(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(match_id): Path<String>,
    ws: WebSocketUpgrade,
) -> Result<axum::response::Response, MatchSocketRouteError> {
    validate_match_id(&match_id)?;

    let participant = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM match_participants
            WHERE match_id::text = $1 AND user_sub = $2
        )
        "#,
    )
    .bind(&match_id)
    .bind(&user.profile.sub)
    .fetch_one(&state.database)
    .await
    .map_err(MatchSocketRouteError::Database)?;

    if !participant {
        return Err(MatchSocketRouteError::Forbidden);
    }

    let registry = state.match_sessions.clone();
    let user_sub = user.profile.sub.clone();

    Ok(ws.on_upgrade(move |socket| handle_match_socket(socket, registry, match_id, user_sub)))
}

async fn password_reset_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<PasswordResetRequestPayload>,
) -> Result<Json<MessageResponse>, PasswordResetRouteError> {
    let email = payload.email.trim();

    if email.is_empty() {
        return Err(PasswordResetRouteError::InvalidRequest(
            "email is required",
        ));
    }

    let reset_token = new_password_reset_token();
    let reset_request =
        create_password_reset_request(&state.database, email, &reset_token).await?;

    if let Some(reset_request) = reset_request {
        let reset_url = password_reset_url(&headers, &state.config, &reset_token.token);
        state
            .email
            .send_password_reset(&reset_request.requested_email, &reset_url)
            .await?;
    }

    Ok(Json(MessageResponse {
        message: "If an account exists for that email, a password reset link has been sent.",
    }))
}

async fn password_reset_confirm(
    State(state): State<AppState>,
    Json(payload): Json<PasswordResetConfirmPayload>,
) -> Result<Json<MessageResponse>, PasswordResetRouteError> {
    let token = payload.token.trim();

    if token.is_empty() {
        return Err(PasswordResetRouteError::InvalidRequest(
            "reset token is required",
        ));
    }

    let changed = confirm_password_reset(&state.database, token, &payload.password).await?;

    if !changed {
        return Err(PasswordResetRouteError::InvalidResetToken);
    }

    Ok(Json(MessageResponse {
        message: "Password reset complete.",
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

async fn handle_match_socket(
    socket: WebSocket,
    registry: MatchSessionRegistry,
    match_id: String,
    user_sub: String,
) {
    let subscription = match registry.subscribe(&match_id, &user_sub).await {
        Ok(subscription) => subscription,
        Err(error) => {
            error!(?error, %match_id, %user_sub, "failed to join match socket session");
            return;
        }
    };

    info!(%match_id, %user_sub, "match socket connected");
    run_match_socket(socket, registry.clone(), subscription).await;

    if let Err(error) = registry.disconnect(&match_id, &user_sub).await {
        error!(?error, %match_id, %user_sub, "failed to clean up match socket session");
    }

    info!(%match_id, %user_sub, "match socket disconnected");
}

async fn run_match_socket(
    socket: WebSocket,
    registry: MatchSessionRegistry,
    subscription: MatchSessionSubscription,
) {
    let match_id = subscription.match_id.clone();
    let user_sub = subscription.user_sub.clone();
    let channel_tx = subscription.sender.clone();
    let connected_message = subscription.connected_message();
    let mut channel_rx = subscription.receiver.resubscribe();
    let (mut outbound, mut inbound) = socket.split();

    if let Ok(message) = connected_message {
        if outbound.send(Message::Text(message)).await.is_err() {
            return;
        }
    }

    let outbound_task = tokio::spawn(async move {
        while let Ok(message) = channel_rx.recv().await {
            if outbound.send(Message::Text(message)).await.is_err() {
                break;
            }
        }
    });

    while let Some(message) = inbound.next().await {
        match message {
            Ok(Message::Text(text)) => {
                if text.len() > MAX_MATCH_SOCKET_TEXT_BYTES {
                    send_match_socket_error(&subscription, &channel_tx, "message too large");
                    continue;
                }

                match registry.handle_client_message(&match_id, &user_sub, &text).await {
                    Ok(event) => {
                        let _ = channel_tx.send(event);
                    }
                    Err(error) => {
                        error!(?error, %match_id, %user_sub, "failed to encode match socket event");
                    }
                }
            }
            Ok(Message::Binary(_)) => {
                send_match_socket_error(
                    &subscription,
                    &channel_tx,
                    "binary messages are not supported",
                );
            }
            Ok(Message::Close(_)) => break,
            Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => {}
            Err(error) => {
                error!(?error, %match_id, %user_sub, "match socket receive failed");
                break;
            }
        }
    }

    outbound_task.abort();
}

fn send_match_socket_error(
    subscription: &MatchSessionSubscription,
    sender: &tokio::sync::broadcast::Sender<String>,
    reason: &'static str,
) {
    match subscription.error_message(reason) {
        Ok(message) => {
            let _ = sender.send(message);
        }
        Err(error) => {
            error!(?error, reason, "failed to encode match socket error");
        }
    }
}

async fn not_found() -> impl IntoResponse {
    (
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
            error: "route not found",
        }),
    )
}

async fn method_not_allowed() -> impl IntoResponse {
    (
        StatusCode::METHOD_NOT_ALLOWED,
        Json(ErrorResponse {
            error: "method not allowed",
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

fn password_reset_url(headers: &HeaderMap, config: &AppConfig, token: &str) -> String {
    format!(
        "{}reset-password?token={}",
        frontend_return_to(headers, config),
        urlencoding::encode(token)
    )
}

const MAX_MATCH_SOCKET_TEXT_BYTES: usize = 8 * 1024;

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
enum PasswordResetRouteError {
    InvalidRequest(&'static str),
    InvalidResetToken,
    Password(PasswordError),
    Database(sqlx::Error),
    Email(EmailError),
}

#[derive(Debug)]
enum MissionProgressRouteError {
    InvalidRequest(&'static str),
    Database(sqlx::Error),
}

#[derive(Debug)]
enum MatchSocketRouteError {
    Database(sqlx::Error),
    Forbidden,
    InvalidMatchId,
}

#[derive(Debug)]
enum MatchmakingRouteError {
    Database(sqlx::Error),
}

impl From<MatchmakingError> for MatchmakingRouteError {
    fn from(error: MatchmakingError) -> Self {
        match error {
            MatchmakingError::Database(error) => Self::Database(error),
        }
    }
}

impl IntoResponse for MatchmakingRouteError {
    fn into_response(self) -> axum::response::Response {
        match self {
            Self::Database(error) => {
                error!(?error, "matchmaking database operation failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: "matchmaking unavailable",
                    }),
                )
                    .into_response()
            }
        }
    }
}

impl From<MatchSessionError> for MatchSocketRouteError {
    fn from(error: MatchSessionError) -> Self {
        match error {
            MatchSessionError::InvalidMatchId => Self::InvalidMatchId,
            MatchSessionError::Serialize(error) => {
                error!(?error, "failed to prepare match socket response");
                Self::InvalidMatchId
            }
        }
    }
}

impl IntoResponse for MatchSocketRouteError {
    fn into_response(self) -> axum::response::Response {
        match self {
            Self::Database(error) => {
                error!(?error, "match socket participant validation failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: "match socket unavailable",
                    }),
                )
                    .into_response()
            }
            Self::Forbidden => (
                StatusCode::FORBIDDEN,
                Json(ErrorResponse {
                    error: "match access denied",
                }),
            )
                .into_response(),
            Self::InvalidMatchId => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "match id is invalid",
                }),
            )
                .into_response(),
        }
    }
}

impl From<MissionProgressError> for MissionProgressRouteError {
    fn from(error: MissionProgressError) -> Self {
        match error {
            MissionProgressError::InvalidMissionKey => {
                Self::InvalidRequest("mission key is required")
            }
            MissionProgressError::InvalidStatus => {
                Self::InvalidRequest("mission progress status is invalid")
            }
            MissionProgressError::InvalidCurrentStep => {
                Self::InvalidRequest("current step must be nonnegative")
            }
            MissionProgressError::InvalidAttempts => {
                Self::InvalidRequest("attempts must be nonnegative")
            }
            MissionProgressError::InvalidBestScore => {
                Self::InvalidRequest("best score must be nonnegative")
            }
            MissionProgressError::InvalidProgress => {
                Self::InvalidRequest("progress must be a JSON object")
            }
            MissionProgressError::Database(error) => Self::Database(error),
        }
    }
}

impl IntoResponse for MissionProgressRouteError {
    fn into_response(self) -> axum::response::Response {
        match self {
            Self::InvalidRequest(error) => (StatusCode::BAD_REQUEST, Json(ErrorResponse { error }))
                .into_response(),
            Self::Database(error) => {
                error!(?error, "mission progress database operation failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: "mission progress unavailable",
                    }),
                )
                    .into_response()
            }
        }
    }
}

impl From<sqlx::Error> for PasswordResetRouteError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}

impl From<PasswordResetError> for PasswordResetRouteError {
    fn from(error: PasswordResetError) -> Self {
        match error {
            PasswordResetError::Password(error) => Self::Password(error),
            PasswordResetError::Database(error) => Self::Database(error),
        }
    }
}

impl From<EmailError> for PasswordResetRouteError {
    fn from(error: EmailError) -> Self {
        Self::Email(error)
    }
}

impl IntoResponse for PasswordResetRouteError {
    fn into_response(self) -> axum::response::Response {
        match self {
            Self::InvalidRequest(error) => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse { error }),
            )
                .into_response(),
            Self::InvalidResetToken => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "reset token is invalid or expired",
                }),
            )
                .into_response(),
            Self::Password(PasswordError::EmptyPassword) => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "password is required",
                }),
            )
                .into_response(),
            Self::Password(PasswordError::PasswordTooLong) => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "password is too long",
                }),
            )
                .into_response(),
            Self::Password(error) => {
                error!(?error, "failed to hash reset password");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: "password reset failed",
                    }),
                )
                    .into_response()
            }
            Self::Database(error) => {
                error!(?error, "password reset database operation failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: "password reset failed",
                    }),
                )
                    .into_response()
            }
            Self::Email(EmailError::RateLimited) => (
                StatusCode::TOO_MANY_REQUESTS,
                Json(ErrorResponse {
                    error: "email rate limited; try again shortly",
                }),
            )
                .into_response(),
            Self::Email(error) => {
                error!(?error, "password reset email send failed");
                (
                    StatusCode::BAD_GATEWAY,
                    Json(ErrorResponse {
                        error: "password reset email unavailable",
                    }),
                )
                    .into_response()
            }
        }
    }
}
