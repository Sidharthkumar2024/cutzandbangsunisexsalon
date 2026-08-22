#!/usr/bin/env bash
# Nightly DB backup + off-server copy. Add to cron:
#   0 2 * * * /opt/cutz-bangs/scripts/backup.sh >> /var/log/cutz-backup.log 2>&1
set -euo pipefail

STAMP=$(date +%Y%m%d-%H%M%S)
OUT_DIR=${BACKUP_DIR:-/opt/cutz-backups}
mkdir -p "$OUT_DIR"
FILE="$OUT_DIR/cutz-$STAMP.sql.gz"
MEDIA_FILE="$OUT_DIR/cutz-media-$STAMP.tar.gz"

echo "[backup] dumping to $FILE"
docker compose exec -T db pg_dump -U "${POSTGRES_USER:-cutz}" "${POSTGRES_DB:-cutz}" | gzip > "$FILE"
echo "[backup] archiving local media fallback"
docker compose exec -T api sh -c 'tar -C /app -czf - .storage 2>/dev/null || true' > "$MEDIA_FILE"

# Off-server copy (configure one). Examples:
#   aws s3 cp "$FILE" "s3://$BACKUP_BUCKET/"
#   rclone copy "$FILE" remote:cutz-backups/
if [ -n "${BACKUP_BUCKET:-}" ]; then
  echo "[backup] uploading off-server"
  aws s3 cp "$FILE" "s3://$BACKUP_BUCKET/"
  aws s3 cp "$MEDIA_FILE" "s3://$BACKUP_BUCKET/"
fi

# Retain 14 days locally
find "$OUT_DIR" -name 'cutz-*.sql.gz' -mtime +14 -delete
find "$OUT_DIR" -name 'cutz-media-*.tar.gz' -mtime +14 -delete
echo "[backup] done"
