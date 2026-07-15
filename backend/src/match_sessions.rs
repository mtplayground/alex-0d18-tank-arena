use std::{collections::HashMap, sync::Arc};

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use tokio::sync::{broadcast, RwLock};

const MATCH_CHANNEL_CAPACITY: usize = 128;
const MAX_MATCH_ID_LEN: usize = 80;

#[derive(Clone, Default)]
pub struct MatchSessionRegistry {
    inner: Arc<RwLock<HashMap<String, MatchSession>>>,
}

impl MatchSessionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn subscribe(
        &self,
        match_id: &str,
        user_sub: &str,
    ) -> Result<MatchSessionSubscription, MatchSessionError> {
        validate_match_id(match_id)?;

        let (sender, receiver, connection_count) = {
            let mut sessions = self.inner.write().await;
            let session = sessions.entry(match_id.to_owned()).or_insert_with(|| {
                let (sender, _) = broadcast::channel(MATCH_CHANNEL_CAPACITY);
                MatchSession {
                    connection_count: 0,
                    sender,
                }
            });

            session.connection_count += 1;

            (
                session.sender.clone(),
                session.sender.subscribe(),
                session.connection_count,
            )
        };

        let joined = MatchSocketEvent::new(
            "player_joined",
            match_id,
            user_sub,
            connection_count,
            json!({}),
        )
        .to_message()?;
        let _ = sender.send(joined);

        Ok(MatchSessionSubscription {
            connection_count,
            match_id: match_id.to_owned(),
            receiver,
            sender,
            user_sub: user_sub.to_owned(),
        })
    }

    pub async fn disconnect(
        &self,
        match_id: &str,
        user_sub: &str,
    ) -> Result<(), MatchSessionError> {
        let (sender, connection_count) = {
            let mut sessions = self.inner.write().await;
            let Some(session) = sessions.get_mut(match_id) else {
                return Ok(());
            };

            session.connection_count = session.connection_count.saturating_sub(1);
            let sender = session.sender.clone();
            let connection_count = session.connection_count;

            if connection_count == 0 {
                sessions.remove(match_id);
            }

            (sender, connection_count)
        };

        let left = MatchSocketEvent::new(
            "player_left",
            match_id,
            user_sub,
            connection_count,
            json!({}),
        )
        .to_message()?;
        let _ = sender.send(left);

        Ok(())
    }
}

#[derive(Debug)]
pub struct MatchSessionSubscription {
    pub connection_count: usize,
    pub match_id: String,
    pub receiver: broadcast::Receiver<String>,
    pub sender: broadcast::Sender<String>,
    pub user_sub: String,
}

impl MatchSessionSubscription {
    pub fn connected_message(&self) -> Result<String, MatchSessionError> {
        MatchSocketEvent::new(
            "session_connected",
            &self.match_id,
            &self.user_sub,
            self.connection_count,
            json!({
                "accepted_message_types": ["player_state", "match_signal"],
            }),
        )
        .to_message()
    }

    pub fn player_message(&self, payload: Value) -> Result<String, MatchSessionError> {
        MatchSocketEvent::new(
            "player_message",
            &self.match_id,
            &self.user_sub,
            self.connection_count,
            payload,
        )
        .to_message()
    }

    pub fn error_message(&self, reason: &'static str) -> Result<String, MatchSessionError> {
        MatchSocketEvent::new(
            "session_error",
            &self.match_id,
            &self.user_sub,
            self.connection_count,
            json!({ "reason": reason }),
        )
        .to_message()
    }
}

pub fn validate_match_id(match_id: &str) -> Result<(), MatchSessionError> {
    let valid = !match_id.is_empty()
        && match_id.len() <= MAX_MATCH_ID_LEN
        && match_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'));

    if valid {
        Ok(())
    } else {
        Err(MatchSessionError::InvalidMatchId)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum MatchSessionError {
    #[error("match id is invalid")]
    InvalidMatchId,
    #[error("match socket event serialization failed")]
    Serialize(#[from] serde_json::Error),
}

#[derive(Clone)]
struct MatchSession {
    connection_count: usize,
    sender: broadcast::Sender<String>,
}

#[derive(Debug, Serialize)]
struct MatchSocketEvent {
    connection_count: usize,
    kind: &'static str,
    match_id: String,
    payload: Value,
    server_time: DateTime<Utc>,
    user_sub: String,
}

impl MatchSocketEvent {
    fn new(
        kind: &'static str,
        match_id: &str,
        user_sub: &str,
        connection_count: usize,
        payload: Value,
    ) -> Self {
        Self {
            connection_count,
            kind,
            match_id: match_id.to_owned(),
            payload,
            server_time: Utc::now(),
            user_sub: user_sub.to_owned(),
        }
    }

    fn to_message(&self) -> Result<String, MatchSessionError> {
        Ok(serde_json::to_string(self)?)
    }
}
