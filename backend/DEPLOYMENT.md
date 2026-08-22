# Deployment runbook — Cutz & Bangs

> What this covers: standing up the backend (API + worker + Postgres + Redis +
> reverse proxy) on a VPS, wiring the live salon site to it, backups, the daily
> maintenance cron, and monitoring. The steps that need **your** credentials or
> manual provider actions are called out and detailed in [CREDENTIALS.md](CREDENTIALS.md).
>
> The code and configuration below are locally verifiable. Production steps
> still need authorised server access and real provider accounts.

If the VPS already runs another application, use
[DEPLOYMENT_ISOLATED.md](DEPLOYMENT_ISOLATED.md) instead. It avoids the existing
ports, containers, database volumes and reverse proxy.

## 0. Prerequisites (YOU)
- A VPS (2 vCPU / 4 GB RAM is plenty to start) with Docker + Docker Compose.
- A domain with an A record pointing at the VPS IP.
- The provider credentials in [CREDENTIALS.md](CREDENTIALS.md).

## 1. Get the code onto the VPS
```bash
git clone <your-repo> /opt/cutz-bangs && cd /opt/cutz-bangs
cp .env.production.example .env      # then edit .env and fill every value
```

## 2. First boot
```bash
docker compose up -d --build            # web, api, worker, db, redis, proxy (Caddy)
docker compose exec api pnpm --filter @cutz/db exec prisma migrate deploy
docker compose exec api pnpm --filter @cutz/db exec tsx prisma/seed.ts        # owner + base data
# optional demo catalog used by the salon booking UI:
docker compose exec api pnpm --filter @cutz/db exec tsx prisma/seed-codex.ts
```
Caddy obtains HTTPS automatically for `DOMAIN`. Health check: `curl https://DOMAIN/health`.

## 3. Wire the live site to the backend
In the **salon** repo's production env:
```
BACKEND_API_URL=https://salon.example.com      # server-side proxy (no browser CORS needed)
NEXT_PUBLIC_API_URL=https://salon.example.com
```
Set the backend's `CORS_ORIGIN=https://salon.example.com` (exact origin, never `*` in prod).
Verify: submit a booking on the live site → it should return a `CB-XXXXXX` reference and
appear in the admin calendar.

## 4. Daily maintenance cron (membership/package expiry + renewal reminders)
On the VPS crontab (`crontab -e`):
```
30 2 * * * curl -fsS -X POST https://salon.example.com/api/v1/maintenance/run \
  -H "x-maintenance-token: $MAINTENANCE_TOKEN" >> /var/log/cutz-maintenance.log 2>&1
```
(`MAINTENANCE_TOKEN` is the value from `.env`.)

## 5. Backups (nightly + off-server)
```
0 2 * * * /opt/cutz-bangs/scripts/backup.sh >> /var/log/cutz-backup.log 2>&1
```
Set `BACKUP_BUCKET` in `.env` for an off-server copy. Restore drill (do this once!):
```bash
./scripts/restore.sh /opt/cutz-backups/cutz-YYYYMMDD-HHMMSS.sql.gz
```

## 6. Deploying an update (no data loss)
```bash
git pull
./scripts/backup.sh                         # always back up before migrating
docker compose up -d --build                # replaces app containers only
docker compose exec api pnpm --filter @cutz/db exec prisma migrate deploy
```
The database lives on a named volume; `up --build` never touches it.

## 7. Monitoring
- Liveness: `GET /health`  •  DB: `GET /health/db` (503 if DB down).
- Point an uptime monitor (UptimeRobot/BetterStack) at `https://DOMAIN/health`.
- Logs: `docker compose logs -f api worker`.
- Queues: reminders/email/campaigns run in the `worker` container; check its logs
  after a server restart to confirm reminder jobs resume (they are idempotent).

## 8. Security hardening checklist
- [ ] `.env` has strong `POSTGRES_PASSWORD`, `SECRETS_KEY`, `MAINTENANCE_TOKEN`, `WA_WEBHOOK_VERIFY_TOKEN`.
- [ ] `CORS_ORIGIN` is the exact site origin (not `*`).
- [ ] Rate limit tuned (`RATE_LIMIT_MAX`); Caddy terminates TLS.
- [ ] DB / Redis ports are NOT published to the host in the prod compose (internal network only).
- [ ] Backups verified by a test restore; `BACKUP_BUCKET` set for off-site.
- [ ] Provider tokens only in `.env` (encrypted at rest via `SECRETS_KEY`), never in the web bundle.
- [ ] Webhook endpoints verify signatures (WhatsApp `WA_APP_SECRET`).

## What only YOU can complete
These cannot be done from code — see [CREDENTIALS.md](CREDENTIALS.md) for exact steps:
1. Provision the VPS + DNS and run steps 1–2.
2. Official WhatsApp: token, phone id, **webhook registration in Meta**, **template approval**.
3. Unofficial WhatsApp: scan the pairing QR with the real salon phone.
4. Real SMTP/SMS keys; real S3/R2 bucket + keys.
5. Point the live salon site's `BACKEND_API_URL` at the deployed API.
