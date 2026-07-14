ALTER TABLE users
ADD COLUMN password_hash TEXT,
ADD COLUMN password_updated_at TIMESTAMPTZ,
ADD CONSTRAINT users_password_hash_argon2id CHECK (
    password_hash IS NULL OR password_hash LIKE '$argon2id$%'
),
ADD CONSTRAINT users_password_updated_at_requires_hash CHECK (
    password_updated_at IS NULL OR password_hash IS NOT NULL
);
