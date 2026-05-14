# Secrets Management — Infisical

> All ShipDB Bot environment variables are managed through [Infisical](https://infisical.com).
> Changes made in Infisical auto-sync to Vercel. Do **not** add/edit env vars directly in the Vercel dashboard.

---

## Overview

| Infisical Environment | Vercel Target | Auto-Sync |
|---|---|---|
| `prod` | Production | ✅ |
| `staging` | Preview | ✅ |
| `dev` | Development | ✅ |

**Sync behavior:** `overwrite-destination` — Infisical is always the source of truth. Any manual changes in Vercel will be overwritten on the next sync.

---

## Managed Secrets

| Secret | Description | Per-Environment |
|---|---|---|
| `DATABASE_URL` | Aurora PostgreSQL (prod fallback) | ✅ |
| `DATABASE_URL_PROD` | Aurora PostgreSQL (production) | ✅ |
| `DATABASE_URL_STAGING` | Aurora PostgreSQL (staging) | ✅ |
| `DATABASE_URL_DEV` | Aurora PostgreSQL (dev) | ✅ |
| `SLACK_BOT_TOKEN` | Slack bot OAuth token | No (shared) |
| `SLACK_SIGNING_SECRET` | Slack app signing secret | No (shared) |
| `SQL_ALLOWED_USER_IDS` | Allowed Slack user IDs for raw SQL | No (shared) |
| `CRON_SECRET` | Vercel cron job auth secret | No (shared) |

---

## Adding / Updating a Secret

1. Log in to [Infisical](https://app.infisical.com) → Project **ShipDB Bot**
2. Select the environment (`prod`, `staging`, or `dev`)
3. Add or update the secret
4. The change auto-syncs to Vercel within seconds

> **Important:** If a secret has different values per environment (e.g. `DATABASE_URL_*`), update it in **each** Infisical environment separately.

---

## Local Development

### Option A: Infisical CLI (Recommended)

```bash
# Install the CLI
brew install infisical/get-cli/infisical

# Login
infisical login

# Run your dev server with secrets injected
infisical run --env=dev -- npm run dev
```

The CLI reads `.infisical.json` in the repo root to know which project/workspace to use.

### Option B: Manual .env file

```bash
# Pull secrets to a local .env file
infisical export --env=dev --format=dotenv > .env

# Or copy and fill in from the template
cp .env.example .env
```

> **Never commit `.env` to git.** It is already in `.gitignore`.

---

## Aurora Password Rotation

AWS Secrets Manager auto-rotates the Aurora master password every 7 days. The `aurora-infisical-rotation-sync` Lambda auto-syncs new passwords to Infisical, which then syncs to Vercel.

If the bot goes down with authentication errors after a rotation, check:
1. Infisical — verify `DATABASE_URL_*` values have the new password
2. Vercel — verify the sync completed (Project → Secret Syncs)
3. Redeploy if needed

---

## Troubleshooting

| Issue | Solution |
|---|---|
| Secret not appearing in Vercel | Check Infisical sync status in Project → Secret Syncs |
| Sync shows "failed" | Usually an ENV_CONFLICT — delete the var from Vercel and re-sync |
| Local dev missing secrets | Run `infisical run --env=dev -- npm run dev` or `infisical export --env=dev` |
| Need to add a new env var | Add in Infisical (all 3 environments), NOT in Vercel |

---

*Last updated: 2026-05-14*
