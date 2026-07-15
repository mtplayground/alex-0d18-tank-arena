# alex-0d18-tank-arena

Managed Creator playground.

## Workspace

This repository is scaffolded as a frontend/backend workspace:

- `frontend/` contains the Vite React client with a Three.js/React Three Fiber scene.
- `backend/` contains the Rust/Axum API service.
- `shared/` contains shared TypeScript protocol contracts for browser/API communication.

## Development

Install JavaScript dependencies:

```bash
npm install
```

Create a local environment file from the example when running the backend locally:

```bash
cp .env.example .env
```

The production runtime injects environment variables directly. Do not commit `.env` files.

Run the backend on `0.0.0.0:8080`:

```bash
cargo run -p backend
```

Run the frontend dev server:

```bash
npm run dev
```

Build and validate the full workspace:

```bash
npm run build
npm run lint
```

Create a self-hosted production bundle:

```bash
npm run deploy:bundle
```

Deployment details live in `deploy/README.md`. The bundle contains the release backend binary, frontend static files, migrations, and service/proxy examples for a bare file/directory host.

## Asset URLs

The backend signs private object-storage assets at request time:

- `GET /api/assets/manifest` returns signed URLs for model, terrain, and texture assets.
- `GET /api/assets/{category}/{asset_id}` redirects to a fresh signed asset URL.

Object keys are always scoped under `OBJECT_STORAGE_PREFIX`.

## Auth Endpoints

The backend uses the platform `mctai_session` cookie directly:

- `GET|POST /api/auth/login` redirects to the myClawTeam auth service.
- `GET|POST /api/auth/register` redirects to the same platform registration/login flow.
- `GET /api/auth/me` is protected by auth middleware that verifies `mctai_session` and upserts the user in PostgreSQL.
