#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-"$ROOT_DIR/dist/self-hosted"}"

cd "$ROOT_DIR"

if [ "${SKIP_NPM_CI:-0}" != "1" ]; then
  echo "==> Installing frontend dependencies"
  npm ci
fi

echo "==> Building frontend"
npm run build --workspace frontend

echo "==> Building backend release binary"
cargo build --workspace --release

echo "==> Creating self-hosted bundle at $OUT_DIR"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/bin" "$OUT_DIR/frontend" "$OUT_DIR/migrations" "$OUT_DIR/deploy/systemd" "$OUT_DIR/deploy/nginx"

cp "$ROOT_DIR/target/release/backend" "$OUT_DIR/bin/alex-0d18-tank-arena"
cp -R "$ROOT_DIR/frontend/dist/." "$OUT_DIR/frontend/"
cp -R "$ROOT_DIR/migrations/." "$OUT_DIR/migrations/"
cp "$ROOT_DIR/scripts/deploy-run.sh" "$OUT_DIR/run.sh"
cp "$ROOT_DIR/deploy/env.production.example" "$OUT_DIR/.env.production.example"
cp "$ROOT_DIR/deploy/systemd/alex-0d18-tank-arena.service.example" "$OUT_DIR/deploy/systemd/"
cp "$ROOT_DIR/deploy/nginx/alex-0d18-tank-arena.conf.example" "$OUT_DIR/deploy/nginx/"
cp "$ROOT_DIR/deploy/README.md" "$OUT_DIR/DEPLOYMENT.md"

chmod +x "$OUT_DIR/bin/alex-0d18-tank-arena" "$OUT_DIR/run.sh"

cat <<EOF
Self-hosted bundle ready:
  $OUT_DIR

Next steps:
  1. Copy this directory to the host, for example /opt/alex-0d18-tank-arena/current.
  2. Copy .env.production.example to .env.production and fill the injected production values.
  3. Run database migrations from the copied migrations directory.
  4. Start ./run.sh and serve ./frontend with the proxy example in deploy/nginx.
EOF
