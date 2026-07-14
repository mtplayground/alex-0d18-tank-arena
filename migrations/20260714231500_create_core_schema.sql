CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE users (
    sub TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    name TEXT,
    picture_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT users_sub_not_blank CHECK (BTRIM(sub) <> ''),
    CONSTRAINT users_email_not_blank CHECK (BTRIM(email) <> '')
);

CREATE TABLE mission_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_sub TEXT NOT NULL REFERENCES users(sub) ON DELETE CASCADE,
    mission_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'not_started',
    current_step INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    best_score INTEGER,
    progress JSONB NOT NULL DEFAULT '{}'::jsonb,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT mission_progress_key_not_blank CHECK (BTRIM(mission_key) <> ''),
    CONSTRAINT mission_progress_status_valid CHECK (
        status IN ('not_started', 'in_progress', 'completed', 'failed')
    ),
    CONSTRAINT mission_progress_current_step_nonnegative CHECK (current_step >= 0),
    CONSTRAINT mission_progress_attempts_nonnegative CHECK (attempts >= 0),
    CONSTRAINT mission_progress_best_score_nonnegative CHECK (
        best_score IS NULL OR best_score >= 0
    ),
    CONSTRAINT mission_progress_completed_at_when_completed CHECK (
        status <> 'completed' OR completed_at IS NOT NULL
    ),
    CONSTRAINT mission_progress_user_mission_unique UNIQUE (user_sub, mission_key)
);

CREATE TABLE matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mode TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    map_key TEXT,
    winner_sub TEXT REFERENCES users(sub) ON DELETE SET NULL,
    duration_ms INTEGER,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT matches_mode_valid CHECK (mode IN ('solo', 'duel')),
    CONSTRAINT matches_status_valid CHECK (status IN ('pending', 'active', 'completed', 'abandoned')),
    CONSTRAINT matches_map_key_not_blank CHECK (map_key IS NULL OR BTRIM(map_key) <> ''),
    CONSTRAINT matches_duration_nonnegative CHECK (duration_ms IS NULL OR duration_ms >= 0),
    CONSTRAINT matches_ended_after_started CHECK (ended_at IS NULL OR ended_at >= started_at),
    CONSTRAINT matches_completed_has_ended_at CHECK (status <> 'completed' OR ended_at IS NOT NULL)
);

CREATE TABLE match_participants (
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    user_sub TEXT NOT NULL REFERENCES users(sub) ON DELETE CASCADE,
    side TEXT NOT NULL,
    result TEXT,
    score INTEGER NOT NULL DEFAULT 0,
    damage_dealt INTEGER NOT NULL DEFAULT 0,
    damage_taken INTEGER NOT NULL DEFAULT 0,
    shots_fired INTEGER NOT NULL DEFAULT 0,
    shots_hit INTEGER NOT NULL DEFAULT 0,
    survived BOOLEAN NOT NULL DEFAULT TRUE,
    stats JSONB NOT NULL DEFAULT '{}'::jsonb,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    left_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (match_id, user_sub),
    CONSTRAINT match_participants_side_not_blank CHECK (BTRIM(side) <> ''),
    CONSTRAINT match_participants_result_valid CHECK (
        result IS NULL OR result IN ('win', 'loss', 'draw', 'abandoned')
    ),
    CONSTRAINT match_participants_score_nonnegative CHECK (score >= 0),
    CONSTRAINT match_participants_damage_dealt_nonnegative CHECK (damage_dealt >= 0),
    CONSTRAINT match_participants_damage_taken_nonnegative CHECK (damage_taken >= 0),
    CONSTRAINT match_participants_shots_fired_nonnegative CHECK (shots_fired >= 0),
    CONSTRAINT match_participants_shots_hit_nonnegative CHECK (shots_hit >= 0),
    CONSTRAINT match_participants_hits_not_more_than_shots CHECK (shots_hit <= shots_fired),
    CONSTRAINT match_participants_left_after_joined CHECK (left_at IS NULL OR left_at >= joined_at)
);

CREATE TABLE user_match_stats (
    user_sub TEXT PRIMARY KEY REFERENCES users(sub) ON DELETE CASCADE,
    matches_played INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    total_score BIGINT NOT NULL DEFAULT 0,
    total_damage_dealt BIGINT NOT NULL DEFAULT 0,
    total_damage_taken BIGINT NOT NULL DEFAULT 0,
    total_shots_fired BIGINT NOT NULL DEFAULT 0,
    total_shots_hit BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_match_stats_counts_nonnegative CHECK (
        matches_played >= 0
        AND wins >= 0
        AND losses >= 0
        AND draws >= 0
        AND total_score >= 0
        AND total_damage_dealt >= 0
        AND total_damage_taken >= 0
        AND total_shots_fired >= 0
        AND total_shots_hit >= 0
    ),
    CONSTRAINT user_match_stats_results_not_more_than_matches CHECK (
        wins + losses + draws <= matches_played
    ),
    CONSTRAINT user_match_stats_hits_not_more_than_shots CHECK (total_shots_hit <= total_shots_fired)
);

CREATE INDEX users_email_idx ON users (LOWER(email));
CREATE INDEX mission_progress_user_status_idx ON mission_progress (user_sub, status);
CREATE INDEX mission_progress_updated_at_idx ON mission_progress (updated_at DESC);
CREATE INDEX matches_status_started_at_idx ON matches (status, started_at DESC);
CREATE INDEX matches_winner_sub_idx ON matches (winner_sub) WHERE winner_sub IS NOT NULL;
CREATE INDEX match_participants_user_joined_idx ON match_participants (user_sub, joined_at DESC);

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER mission_progress_set_updated_at
BEFORE UPDATE ON mission_progress
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER matches_set_updated_at
BEFORE UPDATE ON matches
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER match_participants_set_updated_at
BEFORE UPDATE ON match_participants
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER user_match_stats_set_updated_at
BEFORE UPDATE ON user_match_stats
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
