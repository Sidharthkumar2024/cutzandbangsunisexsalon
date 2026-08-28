# Cutz & Bangs VPS Install Commands

This is the copy-paste runbook for installing the full salon app on a fresh VPS:
frontend, backend API, worker, Postgres, Redis, Caddy HTTPS, and optional WAHA.

## 1. Server Setup

Run on Ubuntu VPS as a sudo user.

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg git ufw

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Log out and log in again, then verify:

```bash
docker --version
docker compose version
```

Open firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

## 2. Upload / Clone Code

Recommended:

```bash
sudo mkdir -p /opt/cutz-bangs
sudo chown "$USER:$USER" /opt/cutz-bangs
git clone https://github.com/Sidharthkumar2024/cutzandbangsunisexsalon.git /opt/cutz-bangs
cd /opt/cutz-bangs
```

If you upload a zip instead:

```bash
sudo mkdir -p /opt/cutz-bangs
sudo chown "$USER:$USER" /opt/cutz-bangs
unzip cutzandbangsunisexsalon.zip -d /opt/cutz-bangs
cd /opt/cutz-bangs
```

## 3. Create Production Env

```bash
cp backend/.env.production.example backend/.env.production
nano backend/.env.production
```

Minimum values to replace before first boot:

```env
DOMAIN=your-domain.com
POSTGRES_PASSWORD=make-a-strong-db-password
DATABASE_URL=postgresql://cutz:make-a-strong-db-password@db:5432/cutz?schema=public
CORS_ORIGIN=https://your-domain.com
PUBLIC_APP_URL=https://your-domain.com
SECRETS_KEY=base64-32-byte-secret
MAINTENANCE_TOKEN=random-long-token
SEED_OWNER_EMAIL=admin@cutzandbangs.in
SEED_OWNER_PASSWORD=Admin@change-this-strong
UPI_VPA=yourupi@bank
UPI_PAYEE=Cutz & Bangs
```

Generate strong secrets:

```bash
openssl rand -base64 32
openssl rand -hex 32
```

Put the base64 value in `SECRETS_KEY`, and the hex value in `MAINTENANCE_TOKEN`.

## 4. First Boot

```bash
cd /opt/cutz-bangs
docker compose --env-file backend/.env.production -f docker-compose.vps.yml up -d --build db redis api worker web proxy
```

Run migrations and create admin:

```bash
docker compose --env-file backend/.env.production -f docker-compose.vps.yml exec api pnpm --filter @cutz/db exec prisma migrate deploy
docker compose --env-file backend/.env.production -f docker-compose.vps.yml exec api pnpm --filter @cutz/db exec tsx prisma/seed.ts
docker compose --env-file backend/.env.production -f docker-compose.vps.yml exec api pnpm --filter @cutz/db exec tsx prisma/seed-codex.ts
```

If this is a fresh production launch and you want to remove all demo/customer
history while keeping services, staff, branches, admin users, settings,
products, inventory, and cash/expense setup:

```bash
docker compose --env-file backend/.env.production -f docker-compose.vps.yml exec -e CONFIRM_CLEAR_CUSTOMER_DATA=yes api pnpm --filter @cutz/db exec tsx prisma/clear-customer-data.ts
```

Verify:

```bash
curl -fsS https://your-domain.com/health
```

Admin login:

```text
URL: https://your-domain.com/admin
Email: value of SEED_OWNER_EMAIL
Password: value of SEED_OWNER_PASSWORD
```

After first successful login, edit env and remove the password:

```bash
nano backend/.env.production
```

Delete this line:

```env
SEED_OWNER_PASSWORD=...
```

Then restart:

```bash
docker compose --env-file backend/.env.production -f docker-compose.vps.yml up -d api worker web
```

## 5. Optional WhatsApp WAHA

Set these in `backend/.env.production`:

```env
WA_UNOFFICIAL_ENABLED=true
WA_UNOFFICIAL_URL=http://waha:3000
WAHA_API_KEY=make-a-long-random-api-key
WAHA_DASHBOARD_USERNAME=admin
WAHA_DASHBOARD_PASSWORD=make-a-strong-dashboard-password
WAHA_ALLOWED_ORIGINS=http://waha:3000
```

Start WAHA:

```bash
docker compose --env-file backend/.env.production -f docker-compose.vps.yml --profile unofficial-wa up -d waha api worker
```

Then open admin Settings and scan the WAHA QR from the salon WhatsApp phone.

## 6. Official WhatsApp / SMTP / Cloud Storage

These are configured inside Admin → Settings:

- SMTP host, port, username, password, from address
- Official WhatsApp Meta token, phone number ID, WABA ID, app secret, webhook verify token
- Cloudinary cloud name, API key, API secret, folder or S3/R2 credentials for permanent invoice/media archive

Official WhatsApp needs public HTTPS invoice media. Unofficial WAHA can send the local PDF inline.

## 7. Daily Backup

Create backup folder:

```bash
sudo mkdir -p /opt/cutz-backups
sudo chown "$USER:$USER" /opt/cutz-backups
```

Add cron:

```bash
crontab -e
```

Add:

```cron
0 2 * * * cd /opt/cutz-bangs/backend && ./scripts/backup.sh >> /var/log/cutz-backup.log 2>&1
30 2 * * * curl -fsS -X POST https://your-domain.com/api/v1/maintenance/run -H "x-maintenance-token: YOUR_MAINTENANCE_TOKEN" >> /var/log/cutz-maintenance.log 2>&1
```

## 8. Update Code Later

```bash
cd /opt/cutz-bangs
git pull
docker compose --env-file backend/.env.production -f docker-compose.vps.yml up -d --build api worker web proxy
docker compose --env-file backend/.env.production -f docker-compose.vps.yml exec api pnpm --filter @cutz/db exec prisma migrate deploy
```

## 9. Useful Commands

Logs:

```bash
docker compose --env-file backend/.env.production -f docker-compose.vps.yml logs -f api worker web
```

Restart:

```bash
docker compose --env-file backend/.env.production -f docker-compose.vps.yml restart api worker web
```

Stop app containers without deleting data:

```bash
docker compose --env-file backend/.env.production -f docker-compose.vps.yml stop
```

Do not run this unless you intentionally want to delete data:

```bash
docker compose -f docker-compose.vps.yml down -v
```
