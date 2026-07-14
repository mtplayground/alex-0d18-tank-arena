use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use tracing::error;

use backend::{
    auth::AuthError,
    users::{upsert_platform_user, PlatformUserInput, UserProfile},
};

use crate::{protocol::ErrorResponse, state::AppState};

#[derive(Clone, Debug)]
pub struct AuthenticatedUser {
    pub profile: UserProfile,
    pub registered: bool,
}

pub async fn require_auth(
    State(state): State<AppState>,
    mut request: Request<Body>,
    next: Next,
) -> Result<Response, AuthMiddlewareError> {
    let claims = state.auth.verify_headers(request.headers()).await?;
    let registration =
        upsert_platform_user(&state.database, PlatformUserInput::from(claims)).await?;

    request.extensions_mut().insert(AuthenticatedUser {
        profile: registration.profile(),
        registered: registration.registered,
    });

    Ok(next.run(request).await)
}

#[derive(Debug)]
pub enum AuthMiddlewareError {
    Auth(AuthError),
    Database(sqlx::Error),
}

impl From<AuthError> for AuthMiddlewareError {
    fn from(error: AuthError) -> Self {
        Self::Auth(error)
    }
}

impl From<sqlx::Error> for AuthMiddlewareError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}

impl IntoResponse for AuthMiddlewareError {
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
