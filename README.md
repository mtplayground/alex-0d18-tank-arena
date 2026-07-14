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
