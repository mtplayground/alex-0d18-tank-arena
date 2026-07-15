CREATE TABLE password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_sub TEXT NOT NULL REFERENCES users(sub) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    requested_email TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT password_reset_tokens_hash_not_blank CHECK (BTRIM(token_hash) <> ''),
    CONSTRAINT password_reset_tokens_requested_email_not_blank CHECK (BTRIM(requested_email) <> ''),
    CONSTRAINT password_reset_tokens_expires_after_created CHECK (expires_at > created_at),
    CONSTRAINT password_reset_tokens_consumed_after_created CHECK (
        consumed_at IS NULL OR consumed_at >= created_at
    )
);

CREATE INDEX password_reset_tokens_user_created_idx
ON password_reset_tokens (user_sub, created_at DESC);

CREATE INDEX password_reset_tokens_active_hash_idx
ON password_reset_tokens (token_hash)
WHERE consumed_at IS NULL;
