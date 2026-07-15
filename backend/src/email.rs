use reqwest::StatusCode;
use serde::Serialize;
use thiserror::Error;
use tracing::{error, info};

use crate::config::{EmailConfig, SecretString};

#[derive(Clone)]
pub enum EmailClient {
    Enabled {
        url: String,
        app_token: SecretString,
        http: reqwest::Client,
    },
    Disabled,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EmailSendStatus {
    Sent,
    SkippedDisabled,
}

#[derive(Debug, Error)]
pub enum EmailError {
    #[error("email service rate limited the request")]
    RateLimited,
    #[error("email request failed: {0}")]
    Request(String),
    #[error("email service returned {status}: {body}")]
    Status { status: StatusCode, body: String },
}

impl EmailClient {
    pub fn from_config(config: &EmailConfig) -> Self {
        match config {
            EmailConfig::Enabled { url, app_token } => Self::Enabled {
                url: url.clone(),
                app_token: app_token.clone(),
                http: reqwest::Client::new(),
            },
            EmailConfig::Disabled => Self::Disabled,
        }
    }

    pub async fn send_password_reset(
        &self,
        to: &str,
        reset_url: &str,
    ) -> Result<EmailSendStatus, EmailError> {
        let Self::Enabled {
            url,
            app_token,
            http,
        } = self
        else {
            info!("password reset email skipped because email is disabled");
            return Ok(EmailSendStatus::SkippedDisabled);
        };

        let payload = EmailPayload {
            to,
            subject: "Password reset",
            html: password_reset_html(reset_url),
            text: password_reset_text(reset_url),
        };
        let response = http
            .post(url)
            .bearer_auth(app_token.as_str())
            .json(&payload)
            .send()
            .await
            .map_err(|error| EmailError::Request(error.to_string()))?;

        if response.status() == StatusCode::TOO_MANY_REQUESTS {
            error!("password reset email was rate limited");
            return Err(EmailError::RateLimited);
        }

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|error| format!("failed to read error body: {error}"));
            error!(%status, "password reset email service returned an error");
            return Err(EmailError::Status { status, body });
        }

        Ok(EmailSendStatus::Sent)
    }
}

#[derive(Serialize)]
struct EmailPayload<'a> {
    to: &'a str,
    subject: &'a str,
    html: String,
    text: String,
}

fn password_reset_html(reset_url: &str) -> String {
    let escaped_url = escape_html(reset_url);

    format!(
        r#"<p>A password reset was requested for your account.</p>
<p><a href="{escaped_url}">Reset your password</a></p>
<p>This link expires in 1 hour. If you did not request it, you can ignore this email.</p>"#
    )
}

fn password_reset_text(reset_url: &str) -> String {
    format!(
        "A password reset was requested for your account.\n\nReset your password: {reset_url}\n\nThis link expires in 1 hour. If you did not request it, you can ignore this email."
    )
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
