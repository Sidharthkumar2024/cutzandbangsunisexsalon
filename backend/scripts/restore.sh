#!/usr/bin/env bash
# Restore a gzipped pg_dump into the running db container.
#   ./scripts/restore.sh /opt/cutz-backups/cutz-20260822-020000.sql.gz [/opt/cutz-backups/cutz-media-20260822-020000.tar.gz]
set -euo pipefail

FILE=${1:?"usage: restore.sh <backup.sql.gz>"}
MEDIA_FILE=${2:-}
echo "[restore] restoring $FILE"
echo "[restore] WARNING: this overwrites the current database."
read -r -p "Type the DB name to confirm (${POSTGRES_DB:-cutz}): " CONFIRM
[ "$CONFIRM" = "${POSTGRES_DB:-cutz}" ] || { echo "aborted"; exit 1; }

gunzip -c "$FILE" | docker compose exec -T db psql -U "${POSTGRES_USER:-cutz}" "${POSTGRES_DB:-cutz}"
if [ -n "$MEDIA_FILE" ]; then
  echo "[restore] restoring local media fallback"
  docker compose exec -T api sh -c 'mkdir -p /app/.storage && tar -C /app -xzf -' < "$MEDIA_FILE"
fi
echo "[restore] done — run migrations if the dump predates a schema change"
