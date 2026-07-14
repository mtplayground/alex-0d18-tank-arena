use serde::Serialize;

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
