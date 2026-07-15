CREATE TABLE match_results (
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    user_sub TEXT NOT NULL REFERENCES users(sub) ON DELETE CASCADE,
    result TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    damage_dealt INTEGER NOT NULL DEFAULT 0,
    damage_taken INTEGER NOT NULL DEFAULT 0,
    shots_fired INTEGER NOT NULL DEFAULT 0,
    shots_hit INTEGER NOT NULL DEFAULT 0,
    survived BOOLEAN NOT NULL DEFAULT TRUE,
    stats JSONB NOT NULL DEFAULT '{}'::jsonb,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (match_id, user_sub),
    FOREIGN KEY (match_id, user_sub)
        REFERENCES match_participants(match_id, user_sub)
        ON DELETE CASCADE,
    CONSTRAINT match_results_result_valid CHECK (
        result IN ('win', 'loss', 'draw', 'abandoned')
    ),
    CONSTRAINT match_results_score_nonnegative CHECK (score >= 0),
    CONSTRAINT match_results_damage_dealt_nonnegative CHECK (damage_dealt >= 0),
    CONSTRAINT match_results_damage_taken_nonnegative CHECK (damage_taken >= 0),
    CONSTRAINT match_results_shots_fired_nonnegative CHECK (shots_fired >= 0),
    CONSTRAINT match_results_shots_hit_nonnegative CHECK (shots_hit >= 0),
    CONSTRAINT match_results_hits_not_more_than_shots CHECK (shots_hit <= shots_fired)
);

CREATE INDEX match_results_user_recorded_idx
ON match_results (user_sub, recorded_at DESC);

CREATE INDEX match_results_match_recorded_idx
ON match_results (match_id, recorded_at DESC);
