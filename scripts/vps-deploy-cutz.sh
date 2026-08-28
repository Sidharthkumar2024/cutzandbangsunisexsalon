#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-cutzandbangs.com}"
APP_DIR="${APP_DIR:-/opt/cutz-bangs}"
REPO_URL="${REPO_URL:-https://github.com/Sidharthkumar2024/cutzandbangsunisexsalon.git}"
ENV_FILE="$APP_DIR/backend/.env.production"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root or with sudo."
  exit 1
fi

apt update
apt install -y ca-certificates curl gnupg git ufw openssl

install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg |
    gpg --dearmor -o /etc/apt/keyrings/docker.gpg
fi
chmod a+r /etc/apt/keyrings/docker.gpg

. /etc/os-release
printf '%s\n' \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
  >/etc/apt/sources.list.d/docker.list

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

mkdir -p "$APP_DIR" /opt/cutz-backups
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
git fetch origin main
git checkout main
git pull --ff-only origin main

if [ ! -f "$ENV_FILE" ]; then
  db_pass="$(openssl rand -base64 32 | tr -d '\n' | tr '/+' '_-')"
  secrets_key="$(openssl rand -base64 32 | tr -d '\n')"
  maintenance_token="$(openssl rand -hex 32)"
  admin_pass="$(openssl rand -base64 18 | tr -d '\n' | tr '/+' '_-')"
  waha_key="$(openssl rand -hex 32)"
  waha_pass="$(openssl rand -base64 18 | tr -d '\n' | tr '/+' '_-')"
  wa_webhook_token="$(openssl rand -hex 24)"
  wa_webhook_secret="$(openssl rand -hex 32)"

  cat >"$ENV_FILE" <<EOF
NODE_ENV=production
WA_DEFAULT_BRANCH_ID=main
DOMAIN=$DOMAIN,www.$DOMAIN
PORT=4000
POSTGRES_USER=cutz
POSTGRES_PASSWORD=$db_pass
POSTGRES_DB=cutz
DATABASE_URL=postgresql://cutz:$db_pass@db:5432/cutz?schema=public
SEED_OWNER_EMAIL=admin@cutzandbangs.in
SEED_OWNER_PASSWORD=$admin_pass
REDIS_URL=redis://redis:6379
CORS_ORIGIN=https://$DOMAIN,https://www.$DOMAIN
RATE_LIMIT_MAX=100
SESSION_TTL_HOURS=168
TOTP_ISSUER="Cutz & Bangs"
PUBLIC_APP_URL=https://$DOMAIN
MAINTENANCE_TOKEN=$maintenance_token
SECRETS_KEY=$secrets_key
SITE_CONTENT_FILE=/app/.storage/site-content.json
STORAGE_DIR=/app/.storage
STORAGE_ENDPOINT=
STORAGE_REGION=auto
STORAGE_BUCKET=cutz-media
STORAGE_ACCESS_KEY=
STORAGE_SECRET_KEY=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
CLOUDINARY_FOLDER=cutz-bangs
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM="Cutz & Bangs <noreply@$DOMAIN>"
SMS_PROVIDER=
SMS_ACCOUNT_SID=
SMS_AUTH_TOKEN=
SMS_FROM=
WA_OFFICIAL_TOKEN=
WA_OFFICIAL_PHONE_ID=
WA_APP_SECRET=
WA_WEBHOOK_VERIFY_TOKEN=$wa_webhook_token
WA_UNOFFICIAL_ENABLED=false
WA_UNOFFICIAL_URL=http://waha:3000
WAHA_ALLOWED_ORIGINS=http://waha:3000
WAHA_API_KEY=$waha_key
WAHA_DASHBOARD_USERNAME=admin
WAHA_DASHBOARD_PASSWORD=$waha_pass
WAHA_SESSION=cutz-bangs-main
WA_UNOFFICIAL_WEBHOOK_SECRET=$wa_webhook_secret
AI_PROVIDER=anthropic
AI_MODEL=claude-sonnet-5
ANTHROPIC_API_KEY=
UPI_VPA=salon@upi
UPI_PAYEE=Cutz & Bangs
BACKUP_DIR=/opt/cutz-backups
BACKUP_BUCKET=
EOF
  chmod 600 "$ENV_FILE"

  cat >/root/cutz-admin-login.txt <<EOF
URL: https://$DOMAIN/admin
Email: admin@cutzandbangs.in
Password: $admin_pass
EOF
  chmod 600 /root/cutz-admin-login.txt
fi

docker compose --env-file "$ENV_FILE" -f docker-compose.vps.yml up -d --build db redis api worker web proxy
docker compose --env-file "$ENV_FILE" -f docker-compose.vps.yml exec -T api pnpm --filter @cutz/db exec prisma migrate deploy
docker compose --env-file "$ENV_FILE" -f docker-compose.vps.yml exec -T api pnpm --filter @cutz/db exec tsx prisma/seed.ts
docker compose --env-file "$ENV_FILE" -f docker-compose.vps.yml exec -T api pnpm --filter @cutz/db exec tsx prisma/seed-codex.ts
docker compose --env-file "$ENV_FILE" -f docker-compose.vps.yml exec -T -e CONFIRM_CLEAR_CUSTOMER_DATA=yes api pnpm --filter @cutz/db exec tsx prisma/clear-customer-data.ts

server_ip="$(curl -4 -fsS ifconfig.me || true)"
echo "DEPLOY_FINISHED"
echo "Server IP: $server_ip"
echo "Admin login saved at /root/cutz-admin-login.txt"
