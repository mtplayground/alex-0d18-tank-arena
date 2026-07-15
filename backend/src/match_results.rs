use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{FromRow, PgPool, Postgres, Transaction};

const DEFAULT_MATCH_RESULTS_LIMIT: i64 = 50;
const MAX_MATCH_RESULTS_LIMIT: i64 = 100;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchResultOutcome {
    Abandoned,
    Draw,
    Loss,
    Win,
}

impl MatchResultOutcome {
    fn as_str(self) -> &'static str {
        match self {
            Self::Abandoned => "abandoned",
            Self::Draw => "draw",
            Self::Loss => "loss",
            Self::Win => "win",
        }
    }
}

impl TryFrom<&str> for MatchResultOutcome {
    type Error = MatchResultsError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "abandoned" => Ok(Self::Abandoned),
            "draw" => Ok(Self::Draw),
            "loss" => Ok(Self::Loss),
            "win" => Ok(Self::Win),
            _ => Err(MatchResultsError::InvalidResult),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct MatchResultsFinalize {
    pub duration_ms: Option<i32>,
    pub participants: Vec<MatchResultParticipantInput>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct MatchResultParticipantInput {
    pub damage_dealt: i32,
    pub damage_taken: i32,
    pub result: MatchResultOutcome,
    pub score: i32,
    pub shots_fired: i32,
    pub shots_hit: i32,
    #[serde(default = "empty_stats")]
    pub stats: Value,
    pub survived: bool,
    pub user_sub: String,
}

impl MatchResultParticipantInput {
    fn validate(&self) -> Result<(), MatchResultsError> {
        if self.user_sub.trim().is_empty() {
            return Err(MatchResultsError::InvalidParticipant);
        }

        if self.score < 0
            || self.damage_dealt < 0
            || self.damage_taken < 0
            || self.shots_fired < 0
            || self.shots_hit < 0
        {
            return Err(MatchResultsError::InvalidStats);
        }

        if self.shots_hit > self.shots_fired {
            return Err(MatchResultsError::InvalidStats);
        }

        if !self.stats.is_object() {
            return Err(MatchResultsError::InvalidStats);
        }

        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct MatchResultEntry {
    pub damage_dealt: i32,
    pub damage_taken: i32,
    pub duration_ms: Option<i32>,
    pub ended_at: Option<DateTime<Utc>>,
    pub map_key: Option<String>,
    pub match_id: String,
    pub mode: String,
    pub recorded_at: DateTime<Utc>,
    pub result: MatchResultOutcome,
    pub score: i32,
    pub shots_fired: i32,
    pub shots_hit: i32,
    pub stats: Value,
    pub survived: bool,
    pub user_sub: String,
    pub winner_sub: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct MatchResultsSummary {
    pub draws: i32,
    pub losses: i32,
    pub matches_played: i32,
    pub total_damage_dealt: i64,
    pub total_damage_taken: i64,
    pub total_score: i64,
    pub total_shots_fired: i64,
    pub total_shots_hit: i64,
    pub updated_at: Option<DateTime<Utc>>,
    pub wins: i32,
}

#[derive(Clone, Debug, Serialize)]
pub struct MatchResultsFinalizeResponse {
    pub match_id: String,
    pub results: Vec<MatchResultEntry>,
    pub status: String,
    pub summary: MatchResultsSummary,
}

#[derive(Debug, thiserror::Error)]
pub enum MatchResultsError {
    #[error("match results are already recorded")]
    AlreadyRecorded,
    #[error("database operation failed")]
    Database(#[from] sqlx::Error),
    #[error("match access denied")]
    Forbidden,
    #[error("duration must be nonnegative")]
    InvalidDuration,
    #[error("participant list is invalid")]
    InvalidParticipant,
    #[error("match result is invalid")]
    InvalidResult,
    #[error("match stats are invalid")]
    InvalidStats,
    #[error("match was not found")]
    NotFound,
}

pub async fn finalize_match_results(
    pool: &PgPool,
    match_id: &str,
    submitted_by: &str,
    input: MatchResultsFinalize,
) -> Result<MatchResultsFinalizeResponse, MatchResultsError> {
    if input.duration_ms.is_some_and(|duration| duration < 0) {
        return Err(MatchResultsError::InvalidDuration);
    }

    validate_participant_inputs(&input.participants)?;

    let mut transaction = pool.begin().await?;
    let match_record = lock_match(&mut transaction, match_id).await?;

    if matches!(match_record.status.as_str(), "completed" | "abandoned")
        || match_has_results(&mut transaction, match_id).await?
    {
        return Err(MatchResultsError::AlreadyRecorded);
    }

    let participant_subs = load_match_participants(&mut transaction, match_id).await?;
    if participant_subs.is_empty() {
        return Err(MatchResultsError::NotFound);
    }

    if !participant_subs.iter().any(|user_sub| user_sub == submitted_by) {
        return Err(MatchResultsError::Forbidden);
    }

    validate_complete_participant_set(&participant_subs, &input.participants)?;
    validate_result_shape(&input.participants)?;

    let winner_sub = input
        .participants
        .iter()
        .find(|participant| participant.result == MatchResultOutcome::Win)
        .map(|participant| participant.user_sub.clone());
    let status = if input
        .participants
        .iter()
        .all(|participant| participant.result == MatchResultOutcome::Abandoned)
    {
        "abandoned"
    } else {
        "completed"
    };
    let duration_ms = input
        .duration_ms
        .or_else(|| elapsed_duration_ms(match_record.started_at));

    sqlx::query(
        r#"
        UPDATE matches
        SET status = $2,
            winner_sub = $3,
            duration_ms = $4,
            ended_at = NOW()
        WHERE id::text = $1
        "#,
    )
    .bind(match_id)
    .bind(status)
    .bind(&winner_sub)
    .bind(duration_ms)
    .execute(&mut *transaction)
    .await?;

    for participant in &input.participants {
        persist_participant_result(&mut transaction, match_id, participant).await?;
        increment_user_match_stats(&mut transaction, participant).await?;
    }

    let results = list_match_result_entries_for_match(&mut transaction, match_id).await?;
    transaction.commit().await?;

    let summary = get_match_results_summary(pool, submitted_by).await?;

    Ok(MatchResultsFinalizeResponse {
        match_id: match_id.to_owned(),
        results,
        status: status.to_owned(),
        summary,
    })
}

pub async fn list_match_results(
    pool: &PgPool,
    user_sub: &str,
    limit: Option<i64>,
) -> Result<(Vec<MatchResultEntry>, MatchResultsSummary), MatchResultsError> {
    let limit = limit
        .unwrap_or(DEFAULT_MATCH_RESULTS_LIMIT)
        .clamp(1, MAX_MATCH_RESULTS_LIMIT);
    let rows = sqlx::query_as::<_, MatchResultRecord>(
        r#"
        SELECT
            mr.match_id::text AS match_id,
            mr.user_sub,
            mr.result,
            mr.score,
            mr.damage_dealt,
            mr.damage_taken,
            mr.shots_fired,
            mr.shots_hit,
            mr.survived,
            mr.stats,
            mr.recorded_at,
            m.mode,
            m.map_key,
            m.winner_sub,
            m.duration_ms,
            m.ended_at
        FROM match_results mr
        JOIN matches m ON m.id = mr.match_id
        WHERE mr.user_sub = $1
        ORDER BY COALESCE(m.ended_at, mr.recorded_at) DESC, mr.recorded_at DESC
        LIMIT $2
        "#,
    )
    .bind(user_sub)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    let results = records_to_entries(rows)?;
    let summary = get_match_results_summary(pool, user_sub).await?;

    Ok((results, summary))
}

async fn lock_match(
    transaction: &mut Transaction<'_, Postgres>,
    match_id: &str,
) -> Result<MatchRecord, MatchResultsError> {
    sqlx::query_as::<_, MatchRecord>(
        r#"
        SELECT status, started_at
        FROM matches
        WHERE id::text = $1
        FOR UPDATE
        "#,
    )
    .bind(match_id)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or(MatchResultsError::NotFound)
}

async fn match_has_results(
    transaction: &mut Transaction<'_, Postgres>,
    match_id: &str,
) -> Result<bool, MatchResultsError> {
    Ok(sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM match_results WHERE match_id::text = $1
        )
        "#,
    )
    .bind(match_id)
    .fetch_one(&mut **transaction)
    .await?)
}

async fn load_match_participants(
    transaction: &mut Transaction<'_, Postgres>,
    match_id: &str,
) -> Result<Vec<String>, MatchResultsError> {
    Ok(sqlx::query_scalar::<_, String>(
        r#"
        SELECT user_sub
        FROM match_participants
        WHERE match_id::text = $1
        ORDER BY user_sub ASC
        "#,
    )
    .bind(match_id)
    .fetch_all(&mut **transaction)
    .await?)
}

async fn persist_participant_result(
    transaction: &mut Transaction<'_, Postgres>,
    match_id: &str,
    participant: &MatchResultParticipantInput,
) -> Result<(), MatchResultsError> {
    let result = participant.result.as_str();

    sqlx::query(
        r#"
        UPDATE match_participants
        SET result = $3,
            score = $4,
            damage_dealt = $5,
            damage_taken = $6,
            shots_fired = $7,
            shots_hit = $8,
            survived = $9,
            stats = $10,
            left_at = COALESCE(left_at, NOW())
        WHERE match_id::text = $1 AND user_sub = $2
        "#,
    )
    .bind(match_id)
    .bind(&participant.user_sub)
    .bind(result)
    .bind(participant.score)
    .bind(participant.damage_dealt)
    .bind(participant.damage_taken)
    .bind(participant.shots_fired)
    .bind(participant.shots_hit)
    .bind(participant.survived)
    .bind(&participant.stats)
    .execute(&mut **transaction)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO match_results (
            match_id,
            user_sub,
            result,
            score,
            damage_dealt,
            damage_taken,
            shots_fired,
            shots_hit,
            survived,
            stats
        )
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        "#,
    )
    .bind(match_id)
    .bind(&participant.user_sub)
    .bind(result)
    .bind(participant.score)
    .bind(participant.damage_dealt)
    .bind(participant.damage_taken)
    .bind(participant.shots_fired)
    .bind(participant.shots_hit)
    .bind(participant.survived)
    .bind(&participant.stats)
    .execute(&mut **transaction)
    .await?;

    Ok(())
}

async fn increment_user_match_stats(
    transaction: &mut Transaction<'_, Postgres>,
    participant: &MatchResultParticipantInput,
) -> Result<(), MatchResultsError> {
    let (wins, losses, draws) = match participant.result {
        MatchResultOutcome::Win => (1, 0, 0),
        MatchResultOutcome::Loss => (0, 1, 0),
        MatchResultOutcome::Draw => (0, 0, 1),
        MatchResultOutcome::Abandoned => (0, 1, 0),
    };

    sqlx::query(
        r#"
        INSERT INTO user_match_stats (
            user_sub,
            matches_played,
            wins,
            losses,
            draws,
            total_score,
            total_damage_dealt,
            total_damage_taken,
            total_shots_fired,
            total_shots_hit
        )
        VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (user_sub) DO UPDATE SET
            matches_played = user_match_stats.matches_played + 1,
            wins = user_match_stats.wins + EXCLUDED.wins,
            losses = user_match_stats.losses + EXCLUDED.losses,
            draws = user_match_stats.draws + EXCLUDED.draws,
            total_score = user_match_stats.total_score + EXCLUDED.total_score,
            total_damage_dealt = user_match_stats.total_damage_dealt + EXCLUDED.total_damage_dealt,
            total_damage_taken = user_match_stats.total_damage_taken + EXCLUDED.total_damage_taken,
            total_shots_fired = user_match_stats.total_shots_fired + EXCLUDED.total_shots_fired,
            total_shots_hit = user_match_stats.total_shots_hit + EXCLUDED.total_shots_hit
        "#,
    )
    .bind(&participant.user_sub)
    .bind(wins)
    .bind(losses)
    .bind(draws)
    .bind(i64::from(participant.score))
    .bind(i64::from(participant.damage_dealt))
    .bind(i64::from(participant.damage_taken))
    .bind(i64::from(participant.shots_fired))
    .bind(i64::from(participant.shots_hit))
    .execute(&mut **transaction)
    .await?;

    Ok(())
}

async fn list_match_result_entries_for_match(
    transaction: &mut Transaction<'_, Postgres>,
    match_id: &str,
) -> Result<Vec<MatchResultEntry>, MatchResultsError> {
    let rows = sqlx::query_as::<_, MatchResultRecord>(
        r#"
        SELECT
            mr.match_id::text AS match_id,
            mr.user_sub,
            mr.result,
            mr.score,
            mr.damage_dealt,
            mr.damage_taken,
            mr.shots_fired,
            mr.shots_hit,
            mr.survived,
            mr.stats,
            mr.recorded_at,
            m.mode,
            m.map_key,
            m.winner_sub,
            m.duration_ms,
            m.ended_at
        FROM match_results mr
        JOIN matches m ON m.id = mr.match_id
        WHERE mr.match_id::text = $1
        ORDER BY mr.score DESC, mr.user_sub ASC
        "#,
    )
    .bind(match_id)
    .fetch_all(&mut **transaction)
    .await?;

    records_to_entries(rows)
}

async fn get_match_results_summary(
    pool: &PgPool,
    user_sub: &str,
) -> Result<MatchResultsSummary, MatchResultsError> {
    let record = sqlx::query_as::<_, MatchResultsSummaryRecord>(
        r#"
        SELECT
            matches_played,
            wins,
            losses,
            draws,
            total_score,
            total_damage_dealt,
            total_damage_taken,
            total_shots_fired,
            total_shots_hit,
            updated_at
        FROM user_match_stats
        WHERE user_sub = $1
        "#,
    )
    .bind(user_sub)
    .fetch_optional(pool)
    .await?;

    Ok(record.map(MatchResultsSummary::from).unwrap_or_default())
}

fn validate_participant_inputs(
    participants: &[MatchResultParticipantInput],
) -> Result<(), MatchResultsError> {
    if participants.is_empty() {
        return Err(MatchResultsError::InvalidParticipant);
    }

    let mut seen = HashSet::new();
    for participant in participants {
        participant.validate()?;
        if !seen.insert(participant.user_sub.as_str()) {
            return Err(MatchResultsError::InvalidParticipant);
        }
    }

    Ok(())
}

fn validate_complete_participant_set(
    expected_participants: &[String],
    inputs: &[MatchResultParticipantInput],
) -> Result<(), MatchResultsError> {
    let expected: HashSet<_> = expected_participants.iter().map(String::as_str).collect();
    let provided: HashSet<_> = inputs
        .iter()
        .map(|participant| participant.user_sub.as_str())
        .collect();

    if expected == provided {
        Ok(())
    } else {
        Err(MatchResultsError::InvalidParticipant)
    }
}

fn validate_result_shape(
    inputs: &[MatchResultParticipantInput],
) -> Result<(), MatchResultsError> {
    let mut counts = HashMap::new();
    for participant in inputs {
        *counts.entry(participant.result.as_str()).or_insert(0usize) += 1;
    }

    let wins = *counts.get("win").unwrap_or(&0);
    let losses = *counts.get("loss").unwrap_or(&0);
    let draws = *counts.get("draw").unwrap_or(&0);
    let abandoned = *counts.get("abandoned").unwrap_or(&0);
    let total = inputs.len();

    if wins == 1 && losses == total.saturating_sub(1) && draws == 0 && abandoned == 0 {
        return Ok(());
    }

    if draws == total && wins == 0 && losses == 0 && abandoned == 0 {
        return Ok(());
    }

    if abandoned == total && wins == 0 && losses == 0 && draws == 0 {
        return Ok(());
    }

    Err(MatchResultsError::InvalidResult)
}

fn elapsed_duration_ms(started_at: DateTime<Utc>) -> Option<i32> {
    let elapsed = Utc::now().signed_duration_since(started_at);
    let milliseconds = elapsed.num_milliseconds().max(0);

    i32::try_from(milliseconds).ok()
}

fn records_to_entries(
    rows: Vec<MatchResultRecord>,
) -> Result<Vec<MatchResultEntry>, MatchResultsError> {
    rows.into_iter().map(MatchResultEntry::try_from).collect()
}

fn empty_stats() -> Value {
    Value::Object(Default::default())
}

#[derive(Debug, FromRow)]
struct MatchRecord {
    started_at: DateTime<Utc>,
    status: String,
}

#[derive(Debug, FromRow)]
struct MatchResultRecord {
    damage_dealt: i32,
    damage_taken: i32,
    duration_ms: Option<i32>,
    ended_at: Option<DateTime<Utc>>,
    map_key: Option<String>,
    match_id: String,
    mode: String,
    recorded_at: DateTime<Utc>,
    result: String,
    score: i32,
    shots_fired: i32,
    shots_hit: i32,
    stats: Value,
    survived: bool,
    user_sub: String,
    winner_sub: Option<String>,
}

impl TryFrom<MatchResultRecord> for MatchResultEntry {
    type Error = MatchResultsError;

    fn try_from(record: MatchResultRecord) -> Result<Self, Self::Error> {
        Ok(Self {
            damage_dealt: record.damage_dealt,
            damage_taken: record.damage_taken,
            duration_ms: record.duration_ms,
            ended_at: record.ended_at,
            map_key: record.map_key,
            match_id: record.match_id,
            mode: record.mode,
            recorded_at: record.recorded_at,
            result: MatchResultOutcome::try_from(record.result.as_str())?,
            score: record.score,
            shots_fired: record.shots_fired,
            shots_hit: record.shots_hit,
            stats: record.stats,
            survived: record.survived,
            user_sub: record.user_sub,
            winner_sub: record.winner_sub,
        })
    }
}

#[derive(Debug, FromRow)]
struct MatchResultsSummaryRecord {
    draws: i32,
    losses: i32,
    matches_played: i32,
    total_damage_dealt: i64,
    total_damage_taken: i64,
    total_score: i64,
    total_shots_fired: i64,
    total_shots_hit: i64,
    updated_at: DateTime<Utc>,
    wins: i32,
}

impl From<MatchResultsSummaryRecord> for MatchResultsSummary {
    fn from(record: MatchResultsSummaryRecord) -> Self {
        Self {
            draws: record.draws,
            losses: record.losses,
            matches_played: record.matches_played,
            total_damage_dealt: record.total_damage_dealt,
            total_damage_taken: record.total_damage_taken,
            total_score: record.total_score,
            total_shots_fired: record.total_shots_fired,
            total_shots_hit: record.total_shots_hit,
            updated_at: Some(record.updated_at),
            wins: record.wins,
        }
    }
}

impl Default for MatchResultsSummary {
    fn default() -> Self {
        Self {
            draws: 0,
            losses: 0,
            matches_played: 0,
            total_damage_dealt: 0,
            total_damage_taken: 0,
            total_score: 0,
            total_shots_fired: 0,
            total_shots_hit: 0,
            updated_at: None,
            wins: 0,
        }
    }
}
