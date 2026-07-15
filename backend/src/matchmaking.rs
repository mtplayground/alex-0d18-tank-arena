use std::{collections::VecDeque, sync::Arc};

use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, PgPool};
use tokio::sync::Mutex;

#[derive(Clone, Default)]
pub struct MatchmakingQueue {
    inner: Arc<Mutex<QueueState>>,
}

impl MatchmakingQueue {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn join(
        &self,
        pool: &PgPool,
        user_sub: &str,
        request: MatchmakingJoinRequest,
    ) -> Result<MatchmakingResponse, MatchmakingError> {
        let arena_size = request.arena_size.unwrap_or_default();
        let opponent = {
            let mut state = self.inner.lock().await;
            state.remove_user(user_sub);

            if let Some(opponent) = state.take_match_for(user_sub, arena_size) {
                Some(opponent)
            } else {
                state.waiting.push_back(QueuedPlayer {
                    arena_size,
                    user_sub: user_sub.to_owned(),
                });

                return Ok(MatchmakingResponse::queued(
                    state.position_for(user_sub).unwrap_or(1),
                    arena_size,
                ));
            }
        };

        let Some(opponent) = opponent else {
            return Ok(MatchmakingResponse::queued(1, arena_size));
        };

        match create_duel_match(pool, user_sub, &opponent.user_sub, arena_size).await {
            Ok(created_match) => Ok(MatchmakingResponse::matched(created_match)),
            Err(error) => {
                let mut state = self.inner.lock().await;
                state.waiting.push_front(opponent);
                Err(error)
            }
        }
    }

    pub async fn status(&self, user_sub: &str) -> MatchmakingResponse {
        let state = self.inner.lock().await;

        if let Some(player) = state.waiting.iter().find(|player| player.user_sub == user_sub) {
            return MatchmakingResponse::queued(
                state.position_for(user_sub).unwrap_or(1),
                player.arena_size,
            );
        }

        MatchmakingResponse::idle()
    }

    pub async fn cancel(&self, user_sub: &str) -> MatchmakingResponse {
        let mut state = self.inner.lock().await;
        state.remove_user(user_sub);

        MatchmakingResponse::idle()
    }
}

#[derive(Debug, Deserialize)]
pub struct MatchmakingJoinRequest {
    pub arena_size: Option<MatchmakingArenaSize>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchmakingArenaSize {
    #[default]
    Duel,
    SmallArena,
}

impl MatchmakingArenaSize {
    fn as_str(self) -> &'static str {
        match self {
            Self::Duel => "duel",
            Self::SmallArena => "small_arena",
        }
    }

    fn map_key(self) -> &'static str {
        match self {
            Self::Duel => "duel-yard",
            Self::SmallArena => "small-arena",
        }
    }
}

#[derive(Debug, Serialize)]
pub struct MatchmakingResponse {
    pub arena_size: Option<MatchmakingArenaSize>,
    pub match_session: Option<MatchmakingMatch>,
    pub queue_position: Option<usize>,
    pub status: MatchmakingStatus,
}

impl MatchmakingResponse {
    fn idle() -> Self {
        Self {
            arena_size: None,
            match_session: None,
            queue_position: None,
            status: MatchmakingStatus::Idle,
        }
    }

    fn matched(match_session: MatchmakingMatch) -> Self {
        Self {
            arena_size: Some(match_session.arena_size),
            match_session: Some(match_session),
            queue_position: None,
            status: MatchmakingStatus::Matched,
        }
    }

    fn queued(queue_position: usize, arena_size: MatchmakingArenaSize) -> Self {
        Self {
            arena_size: Some(arena_size),
            match_session: None,
            queue_position: Some(queue_position),
            status: MatchmakingStatus::Queued,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchmakingStatus {
    Idle,
    Matched,
    Queued,
}

#[derive(Debug, Serialize)]
pub struct MatchmakingMatch {
    pub arena_size: MatchmakingArenaSize,
    pub match_id: String,
    pub participants: Vec<MatchmakingParticipant>,
    pub websocket_path: String,
}

#[derive(Debug, Serialize)]
pub struct MatchmakingParticipant {
    pub side: &'static str,
    pub user_sub: String,
}

#[derive(Debug, thiserror::Error)]
pub enum MatchmakingError {
    #[error("database operation failed")]
    Database(#[from] sqlx::Error),
}

#[derive(Default)]
struct QueueState {
    waiting: VecDeque<QueuedPlayer>,
}

impl QueueState {
    fn position_for(&self, user_sub: &str) -> Option<usize> {
        self.waiting
            .iter()
            .position(|player| player.user_sub == user_sub)
            .map(|index| index + 1)
    }

    fn remove_user(&mut self, user_sub: &str) {
        self.waiting.retain(|player| player.user_sub != user_sub);
    }

    fn take_match_for(
        &mut self,
        user_sub: &str,
        arena_size: MatchmakingArenaSize,
    ) -> Option<QueuedPlayer> {
        let index = self
            .waiting
            .iter()
            .position(|player| player.user_sub != user_sub && player.arena_size == arena_size)?;

        self.waiting.remove(index)
    }
}

#[derive(Debug)]
struct QueuedPlayer {
    arena_size: MatchmakingArenaSize,
    user_sub: String,
}

async fn create_duel_match(
    pool: &PgPool,
    challenger_sub: &str,
    opponent_sub: &str,
    arena_size: MatchmakingArenaSize,
) -> Result<MatchmakingMatch, MatchmakingError> {
    let mut transaction = pool.begin().await?;
    let metadata = json!({
        "arena_size": arena_size.as_str(),
        "matchmaking": true,
    });
    let match_record = sqlx::query_as::<_, CreatedMatchRecord>(
        r#"
        INSERT INTO matches (mode, status, map_key, metadata)
        VALUES ('duel', 'active', $1, $2)
        RETURNING id::text AS id
        "#,
    )
    .bind(arena_size.map_key())
    .bind(metadata)
    .fetch_one(&mut *transaction)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO match_participants (match_id, user_sub, side)
        VALUES
            ($1::uuid, $2, 'alpha'),
            ($1::uuid, $3, 'bravo')
        "#,
    )
    .bind(&match_record.id)
    .bind(challenger_sub)
    .bind(opponent_sub)
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;

    Ok(MatchmakingMatch {
        arena_size,
        match_id: match_record.id.clone(),
        participants: vec![
            MatchmakingParticipant {
                side: "alpha",
                user_sub: challenger_sub.to_owned(),
            },
            MatchmakingParticipant {
                side: "bravo",
                user_sub: opponent_sub.to_owned(),
            },
        ],
        websocket_path: format!("/api/ws/matches/{}", match_record.id),
    })
}

#[derive(Debug, FromRow)]
struct CreatedMatchRecord {
    id: String,
}
