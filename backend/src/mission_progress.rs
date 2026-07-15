use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{FromRow, PgPool};

#[derive(Clone, Debug, Serialize)]
pub struct MissionProgressEntry {
    pub mission_key: String,
    pub status: MissionProgressStatus,
    pub current_step: i32,
    pub attempts: i32,
    pub best_score: Option<i32>,
    pub progress: Value,
    pub completed_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MissionProgressStatus {
    NotStarted,
    InProgress,
    Completed,
    Failed,
}

impl MissionProgressStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotStarted => "not_started",
            Self::InProgress => "in_progress",
            Self::Completed => "completed",
            Self::Failed => "failed",
        }
    }
}

impl TryFrom<&str> for MissionProgressStatus {
    type Error = MissionProgressError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "not_started" => Ok(Self::NotStarted),
            "in_progress" => Ok(Self::InProgress),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            _ => Err(MissionProgressError::InvalidStatus),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct MissionProgressUpsert {
    pub status: MissionProgressStatus,
    pub current_step: i32,
    pub attempts: i32,
    pub best_score: Option<i32>,
    #[serde(default = "empty_progress")]
    pub progress: Value,
}

impl MissionProgressUpsert {
    fn validate(&self, mission_key: &str) -> Result<(), MissionProgressError> {
        if mission_key.trim().is_empty() {
            return Err(MissionProgressError::InvalidMissionKey);
        }

        if self.current_step < 0 {
            return Err(MissionProgressError::InvalidCurrentStep);
        }

        if self.attempts < 0 {
            return Err(MissionProgressError::InvalidAttempts);
        }

        if self.best_score.is_some_and(|score| score < 0) {
            return Err(MissionProgressError::InvalidBestScore);
        }

        if !self.progress.is_object() {
            return Err(MissionProgressError::InvalidProgress);
        }

        Ok(())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum MissionProgressError {
    #[error("mission key is required")]
    InvalidMissionKey,
    #[error("mission progress status is invalid")]
    InvalidStatus,
    #[error("current step must be nonnegative")]
    InvalidCurrentStep,
    #[error("attempts must be nonnegative")]
    InvalidAttempts,
    #[error("best score must be nonnegative")]
    InvalidBestScore,
    #[error("progress must be a JSON object")]
    InvalidProgress,
    #[error("database operation failed")]
    Database(#[from] sqlx::Error),
}

pub async fn list_mission_progress(
    pool: &PgPool,
    user_sub: &str,
) -> Result<Vec<MissionProgressEntry>, MissionProgressError> {
    let rows = sqlx::query_as::<_, MissionProgressRecord>(
        r#"
        SELECT
            mission_key,
            status,
            current_step,
            attempts,
            best_score,
            progress,
            completed_at,
            updated_at
        FROM mission_progress
        WHERE user_sub = $1
        ORDER BY current_step ASC, updated_at ASC
        "#,
    )
    .bind(user_sub)
    .fetch_all(pool)
    .await?;

    rows.into_iter().map(MissionProgressEntry::try_from).collect()
}

pub async fn upsert_mission_progress(
    pool: &PgPool,
    user_sub: &str,
    mission_key: &str,
    input: MissionProgressUpsert,
) -> Result<MissionProgressEntry, MissionProgressError> {
    let mission_key = mission_key.trim();
    input.validate(mission_key)?;

    let status = input.status.as_str();
    let completed_at = (input.status == MissionProgressStatus::Completed).then(Utc::now);
    let record = sqlx::query_as::<_, MissionProgressRecord>(
        r#"
        INSERT INTO mission_progress (
            user_sub,
            mission_key,
            status,
            current_step,
            attempts,
            best_score,
            progress,
            completed_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (user_sub, mission_key) DO UPDATE SET
            status = EXCLUDED.status,
            current_step = EXCLUDED.current_step,
            attempts = GREATEST(mission_progress.attempts, EXCLUDED.attempts),
            best_score = CASE
                WHEN mission_progress.best_score IS NULL THEN EXCLUDED.best_score
                WHEN EXCLUDED.best_score IS NULL THEN mission_progress.best_score
                ELSE GREATEST(mission_progress.best_score, EXCLUDED.best_score)
            END,
            progress = EXCLUDED.progress,
            completed_at = CASE
                WHEN EXCLUDED.status = 'completed'
                    THEN COALESCE(mission_progress.completed_at, EXCLUDED.completed_at, NOW())
                ELSE NULL
            END
        RETURNING
            mission_key,
            status,
            current_step,
            attempts,
            best_score,
            progress,
            completed_at,
            updated_at
        "#,
    )
    .bind(user_sub)
    .bind(mission_key)
    .bind(status)
    .bind(input.current_step)
    .bind(input.attempts)
    .bind(input.best_score)
    .bind(input.progress)
    .bind(completed_at)
    .fetch_one(pool)
    .await?;

    MissionProgressEntry::try_from(record)
}

fn empty_progress() -> Value {
    Value::Object(Default::default())
}

#[derive(Debug, FromRow)]
struct MissionProgressRecord {
    mission_key: String,
    status: String,
    current_step: i32,
    attempts: i32,
    best_score: Option<i32>,
    progress: Value,
    completed_at: Option<DateTime<Utc>>,
    updated_at: DateTime<Utc>,
}

impl TryFrom<MissionProgressRecord> for MissionProgressEntry {
    type Error = MissionProgressError;

    fn try_from(record: MissionProgressRecord) -> Result<Self, Self::Error> {
        Ok(Self {
            mission_key: record.mission_key,
            status: MissionProgressStatus::try_from(record.status.as_str())?,
            current_step: record.current_step,
            attempts: record.attempts,
            best_score: record.best_score,
            progress: record.progress,
            completed_at: record.completed_at,
            updated_at: record.updated_at,
        })
    }
}
