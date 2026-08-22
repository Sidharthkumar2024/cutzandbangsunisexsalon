#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${CUTZ_ENV_FILE:-$BACKEND_DIR/.env.isolated}"
OUT_DIR="${CUTZ_BACKUP_DIR:-/opt/cutz-bangs-v2-backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DB_FILE="$OUT_DIR/cutz-bangs-v2-$STAMP.sql.gz"
MEDIA_FILE="$OUT_DIR/cutz-bangs-v2-media-$STAMP.tar.gz"
COMPOSE=(docker compose --project-name cutz-bangs-v2 --env-file "$ENV_FILE" -f "$BACKEND_DIR/docker-compose.isolated.yml")

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing isolated environment file: $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
"${COMPOSE[@]}" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$DB_FILE"
"${COMPOSE[@]}" exec -T api sh -c 'tar -C /app -czf - .storage 2>/dev/null || true' > "$MEDIA_FILE"
find "$OUT_DIR" -name 'cutz-bangs-v2-*.sql.gz' -mtime +14 -delete
find "$OUT_DIR" -name 'cutz-bangs-v2-media-*.tar.gz' -mtime +14 -delete
echo "Isolated backup complete: $DB_FILE"
