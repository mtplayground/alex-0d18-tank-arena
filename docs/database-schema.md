# Database Schema

Issue #2 establishes the PostgreSQL schema for durable user records, solo mission progress,
and match history/statistics.

## Tables

- `users`: one row per authenticated platform user, keyed by the stable auth `sub`.
  Optional local password hashes are stored as Argon2id PHC strings for flows that need a
  password verifier; platform-auth users can leave these fields null.
- `mission_progress`: per-user mission state with a unique `(user_sub, mission_key)` pair.
- `matches`: one row per solo or duel match, including lifecycle status and winner.
- `match_participants`: per-user match results and combat counters.
- `user_match_stats`: denormalized aggregate counters for profile and matchmaking views.

Rows with an `updated_at` column use a shared trigger to refresh the timestamp on every update.

## Migration

Run from the repository root with the provisioned PostgreSQL connection string:

```bash
export DATABASE_URL=$(cat /workspace/.database_url)
sqlx migrate run
```

The backend also includes `db::connect_from_env` and `db::run_migrations` so later issues can
wire migration execution into startup without changing the migration layout.
