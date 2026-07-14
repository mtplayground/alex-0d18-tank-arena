use serde::Serialize;

use backend::users::UserProfile;

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub ok: bool,
    pub service: &'static str,
    pub version: &'static str,
}

#[derive(Debug, Serialize)]
pub struct RuntimeStatus {
    pub api_base_url: &'static str,
    pub rendering: RenderingStatus,
}

#[derive(Debug, Serialize)]
pub struct RenderingStatus {
    pub engine: &'static str,
    pub react_renderer: &'static str,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: &'static str,
}

#[derive(Debug, Serialize)]
pub struct AuthSessionResponse {
    pub user: UserProfile,
    pub registered: bool,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct AssetManifestResponse {
    pub assets: Vec<AssetResponse>,
    pub expires_in_seconds: u64,
}

#[derive(Debug, Serialize)]
pub struct AssetResponse {
    pub id: &'static str,
    pub category: &'static str,
    pub label: &'static str,
    pub content_type: &'static str,
    pub url: String,
}
