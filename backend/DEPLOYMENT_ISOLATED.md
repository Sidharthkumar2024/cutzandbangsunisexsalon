# Isolated VPS deployment — no changes to the existing GMB workload

This backend is intentionally installed as a second, namespaced stack. It does
not reuse the existing application's directory, containers, database volumes,
ports 80/443, or reverse-proxy configuration.

## Isolation contract

- Directory: `/opt/cutz-bangs-v2`
- Compose project: `cutz-bangs-v2`
- Local-only API port: `127.0.0.1:8410`
- Dedicated database, Redis, media, and WhatsApp volumes prefixed `cutz_bangs_v2_`
- Public traffic arrives through a new Cloudflare Tunnel hostname or one small,
  separately reviewed route in the existing reverse proxy.
- Never run `docker compose down -v`; the `-v` option deletes this app's data.

## Before any write on the VPS

Capture a read-only inventory first:

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
ss -lntp
df -h
```

Confirm that port `8410` and `/opt/cutz-bangs-v2` are unused. Do not stop,
rename, recreate, or edit the existing GMB containers or script.

## First isolated boot

```bash
git clone https://github.com/Sidharthkumar2024/cutzandbangsunisexsalon.git /opt/cutz-bangs-v2
cd /opt/cutz-bangs-v2/backend
cp .env.isolated.example .env.isolated
# Fill strong database, encryption, maintenance and provider secrets.
docker compose --project-name cutz-bangs-v2 --env-file .env.isolated -f docker-compose.isolated.yml up -d --build db redis api worker
docker compose --project-name cutz-bangs-v2 --env-file .env.isolated -f docker-compose.isolated.yml exec api pnpm --filter @cutz/db exec prisma migrate deploy
docker compose --project-name cutz-bangs-v2 --env-file .env.isolated -f docker-compose.isolated.yml exec api pnpm --filter @cutz/db exec tsx prisma/seed.ts
```

Verify locally on the VPS: `curl -fsS http://127.0.0.1:8410/health`.

## Cloudflare without touching the current reverse proxy

Create a new Cloudflare Tunnel and map a new hostname such as
`api.example.com` to `http://api:4000`. Put its token in `.env.isolated`, then:

```bash
docker compose --project-name cutz-bangs-v2 --env-file .env.isolated -f docker-compose.isolated.yml --profile cloudflare up -d cloudflared
```

Only after HTTPS health succeeds, set the hosted website's server-side
`BACKEND_API_URL=https://api.example.com`. Keep the public landing page online
while this is tested; switching the backend URL is reversible.

## SMTP and 2FA order

1. Change the seeded owner password before exposing the hostname.
2. Sign in at `/admin/login` and enable authenticator 2FA in Settings.
3. Add SMTP host, port, username, sender and password in Settings; send the
   built-in test email.
4. Publish SPF and DKIM records supplied by the mailbox provider in Cloudflare.
5. Store recovery codes offline and run a second-browser login test.

Real SMTP credentials, the public hostname, Cloudflare tunnel token, and VPS
access are intentionally not committed to Git.
