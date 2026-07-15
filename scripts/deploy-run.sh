#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${APP_ENV_FILE:-"$APP_DIR/.env.production"}"
BINARY="${APP_BINARY:-"$APP_DIR/bin/alex-0d18-tank-arena"}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing production environment file: $ENV_FILE" >&2
  echo "Create it from .env.production.example and fill the provisioned values." >&2
  exit 1
fi

if [ ! -x "$BINARY" ]; then
  echo "Missing executable backend binary: $BINARY" >&2
  exit 1
fi

export APP_ENV_FILE="$ENV_FILE"
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-8080}"

exec "$BINARY"
