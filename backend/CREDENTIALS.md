# Credentials & provider setup — the "only you can do this" checklist

These items need real accounts, phone numbers, or manual approvals. The code is
already written to consume them; each section says exactly what to get and where
to put it in `.env`. Nothing here can be automated from the codebase.

---

## 1. Official WhatsApp Business Platform (Meta Cloud API)
1. Create a Meta app at developers.facebook.com → add the **WhatsApp** product.
2. Add/verify your business phone number → note the **Phone number ID**.
   Also note the **WhatsApp Business Account ID** → `WA_OFFICIAL_WABA_ID`.
3. Create a **permanent System User token** with `whatsapp_business_messaging` +
   `whatsapp_business_management` → `WA_OFFICIAL_TOKEN`.
4. App Settings → Basic → **App secret** → `WA_APP_SECRET`.
5. Choose any random string for `WA_WEBHOOK_VERIFY_TOKEN` and put the same value in:
   - `.env`, and
   - Meta → WhatsApp → Configuration → **Webhook**:
     - Callback URL: `https://salon.example.com/api/v1/webhooks/whatsapp`
     - Verify token: your `WA_WEBHOOK_VERIFY_TOKEN`
     - Subscribe to the `messages` field.
   (The backend already answers the GET verification handshake and verifies the
   `X-Hub-Signature-256` on inbound POSTs.)
6. **Template approval:** WhatsApp → Message Templates → submit your
   confirmation/reminder templates → wait for Meta approval (hours–days). Use the
   approved template *names* in the campaign/reminder config.
   → Fill `WA_OFFICIAL_TOKEN`, `WA_OFFICIAL_PHONE_ID`, `WA_OFFICIAL_WABA_ID`,
   `WA_APP_SECRET`, `WA_WEBHOOK_VERIFY_TOKEN`.

## 2. Unofficial WhatsApp connector (optional — account-ban risk)
- Set `WA_UNOFFICIAL_ENABLED=true` only if you accept that this can get the number
  restricted (against WhatsApp ToS). Keep it isolated to its own worker.
- Pairing is one-time at runtime: start the connector, open its QR (in logs / the
  admin inbox), and **scan it from WhatsApp → Linked Devices** on the salon phone.
- Then send a test message to the number and confirm it appears in the unified inbox,
  and reply from the inbox to confirm outbound. (Needs the real phone — your step.)

## 3. Email (transactional + campaigns)
- Pick an SMTP provider (Postmark, SendGrid, SES, Mailgun). Verify your sending
  domain (SPF/DKIM) so mail isn't spam-filtered.
- → `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`.
- Without these, the worker logs emails in "dev mode" instead of sending.

## 4. SMS (optional)
- Twilio (or local Indian provider). → `SMS_PROVIDER`, `SMS_ACCOUNT_SID`,
  `SMS_AUTH_TOKEN`, `SMS_FROM`.

## 5. Object storage (invoices, attendance selfies, vendor bills)
- Cloudinary option: create/read API credentials from Cloudinary Console →
  Programmable Media → API keys.
  → `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`,
  `CLOUDINARY_FOLDER=cutz-bangs`.
- S3/R2 option: create an S3 or Cloudflare R2 bucket + access keys.
- → `STORAGE_ENDPOINT` (blank for AWS S3), `STORAGE_REGION`, `STORAGE_BUCKET`,
  `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`.
- If Cloudinary and S3/R2 are both blank, files are stored on the local disk at
  `STORAGE_DIR` (fine to start; move to object storage before scaling or before
  sending official WhatsApp invoice PDFs).

## 6. AI (campaign copy, inbox FAQ, vendor-bill OCR)
- Anthropic API key → `ANTHROPIC_API_KEY`. Without it, AI features degrade
  gracefully (drafts return a stub; the FAQ assistant hands off to a human).

## 7. Payments
- Payment **gateway is out of scope** per your instruction. POS uses UPI QR +
  manual "mark as paid". → set `UPI_VPA`, `UPI_PAYEE` to your salon's UPI id.

## 8. Server + domain
- VPS with Docker, a domain, and DNS A record → VPS IP. Then follow
  [DEPLOYMENT.md](DEPLOYMENT.md).

---

### Quick status map (what's code-done vs credential-blocked)
| Feature | Code | Needs you |
|---|---|---|
| Booking / POS / CRM / membership / package / inventory / campaigns | ✅ done | — |
| Returns/refunds, discount approval, expiry/renewal automation, consolidated reports | ✅ done | — |
| PDF invoices + email delivery | ✅ done | SMTP keys to actually send |
| Object storage | ✅ done (local + Cloudinary + S3/R2) | Cloudinary or S3/R2 credentials for cloud |
| Official WhatsApp | ✅ code + webhook + signature | token, phone ID, WABA ID, webhook registration, template approval |
| Unofficial WhatsApp | ✅ isolated connector | scan QR with real phone |
| SMS reminders | adapter-ready | SMS provider keys |
| Production deploy | ✅ compose + runbook | your VPS + domain |
| Payment gateway | out of scope | — |
