#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-$BACKEND_DIR/.env.local}"

if [[ ! -f "$PROJECT_DIR/.env.local" ]]; then
  cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env.local"
fi
if [[ ! -f "$BACKEND_ENV_FILE" ]]; then
  cp "$BACKEND_DIR/.env.local.example" "$BACKEND_ENV_FILE"
fi

if ! nc -z 127.0.0.1 5433 >/dev/null 2>&1 || ! nc -z 127.0.0.1 6382 >/dev/null 2>&1 || ! nc -z 127.0.0.1 3005 >/dev/null 2>&1; then
  docker compose -f "$BACKEND_DIR/docker-compose.local.yml" up -d db redis waha
fi

if [[ ! -d "$PROJECT_DIR/node_modules" ]]; then
  npm install --prefix "$PROJECT_DIR"
fi
if [[ ! -d "$BACKEND_DIR/node_modules" ]]; then
  corepack pnpm --dir "$BACKEND_DIR" install --frozen-lockfile
fi

set -a
source "$BACKEND_ENV_FILE"
set +a

corepack pnpm --dir "$BACKEND_DIR" db:generate
corepack pnpm --dir "$BACKEND_DIR" db:deploy
corepack pnpm --dir "$BACKEND_DIR" db:seed:codex

cleanup() {
  kill "${API_PID:-}" "${WORKER_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

corepack pnpm --dir "$BACKEND_DIR" dev:api &
API_PID=$!
corepack pnpm --dir "$BACKEND_DIR" dev:worker &
WORKER_PID=$!

echo "Waiting for the secure backend to become healthy…"
BACKEND_READY=0
for attempt in $(seq 1 60); do
  if curl --fail --silent --show-error --max-time 2 http://127.0.0.1:4100/health >/dev/null 2>&1; then
    BACKEND_READY=1
    break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "Backend API stopped before it became healthy." >&2
    wait "$API_PID" || true
    exit 1
  fi
  sleep 1
done

if [[ "$BACKEND_READY" -ne 1 ]]; then
  echo "Backend API did not become healthy within 60 seconds." >&2
  exit 1
fi

echo "Cutz & Bangs is ready: website http://localhost:3000 · API http://localhost:4100/health · WAHA http://localhost:3005"
export PORT=3000
npm --prefix "$PROJECT_DIR" run dev
