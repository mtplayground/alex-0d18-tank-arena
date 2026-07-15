# Self-Hosted Deployment

This deployment path builds a bare directory that can be copied to a host and run without Docker or CI/CD.

## Build Bundle

From the repository root:

```bash
npm run deploy:bundle
```

The bundle is written to `dist/self-hosted` by default. Set `OUT_DIR=/path/to/output` to choose another directory. The bundle contains:

- `bin/alex-0d18-tank-arena`: release backend binary
- `frontend/`: static Vite build
- `migrations/`: PostgreSQL migrations
- `run.sh`: production backend launcher
- `.env.production.example`: production environment template
- `deploy/systemd/` and `deploy/nginx/`: service and proxy examples

If dependencies are already installed and you only want to rebuild, run:

```bash
SKIP_NPM_CI=1 npm run deploy:bundle
```

## Server Setup

Copy the bundle to the server, for example:

```bash
sudo mkdir -p /opt/alex-0d18-tank-arena
sudo rsync -a dist/self-hosted/ /opt/alex-0d18-tank-arena/current/
```

Create the production environment file without committing it:

```bash
cd /opt/alex-0d18-tank-arena/current
cp .env.production.example .env.production
```

Fill `.env.production` with the provisioned values. Keep `HOST=0.0.0.0` and `PORT=8080` unless the host requires a different backend bind. Set `SELF_URL` and `ALLOWED_CORS_ORIGIN` to the public site origin.

Use the exact object storage variable names from the template. `OBJECT_STORAGE_PREFIX` must stay set because backend storage keys are scoped under that prefix.

## Database Migrations

Run migrations before starting a new release:

```bash
export DATABASE_URL='postgresql://user:password@host:5432/app_database'
sqlx migrate run --source ./migrations
```

If `sqlx` is not installed on the server:

```bash
cargo install sqlx-cli --no-default-features --features rustls,postgres
```

## Start Backend

For a direct smoke test:

```bash
APP_ENV_FILE=/opt/alex-0d18-tank-arena/current/.env.production \
  /opt/alex-0d18-tank-arena/current/run.sh
```

For systemd, copy `deploy/systemd/alex-0d18-tank-arena.service.example` to `/etc/systemd/system/alex-0d18-tank-arena.service`, adjust the user and paths if needed, then run:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now alex-0d18-tank-arena
```

## Serve Frontend

Serve `frontend/` as static files and reverse proxy `/api/` plus `/api/ws/` to the backend on `127.0.0.1:8080`. The nginx example in `deploy/nginx/alex-0d18-tank-arena.conf.example` includes WebSocket upgrade headers and SPA fallback routing.

For same-origin hosting, leave `VITE_API_BASE_URL` empty when building. If the API is hosted on a separate origin, set `VITE_API_BASE_URL` before running `npm run deploy:bundle`.
