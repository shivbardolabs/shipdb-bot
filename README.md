# 📦 ShipDB Bot

A Slack bot for querying the ShipOS Pro database. Deployed on Vercel, connects to Aurora PostgreSQL (via RDS Proxy).

## Available Commands

| Command | Description |
|---------|-------------|
| `/shipdb stats` | Database overview — counts for clients, users, customers, packages |
| `/shipdb clients` | List all clients (tenants) with user/customer counts |
| `/shipdb client <name>` | Detailed view of a specific client — users, stores, package count |
| `/shipdb users [client]` | List users, optionally filtered by client name |
| `/shipdb customers [client]` | List customers, optionally filtered by client name |
| `/shipdb packages [status]` | Package overview with status breakdown (filter: checked_in, released, etc.) |
| `/shipdb stores` | List all stores with addresses |
| `/shipdb search <term>` | Search across clients, users, and customers |
| `/shipdb sql <query>` | Run a read-only SELECT query (can be restricted to specific users) |
| `/shipdb env` | Show available environments and their status |
| `/shipdb help` | Show all commands |

All responses are **ephemeral** (only visible to the user who ran the command).

### Environment Targeting

Append `--env dev`, `--env staging`, or `--env prod` to any query command to target a specific database:

```
/shipdb stats --env dev          # Dev database overview
/shipdb clients --env staging    # List clients on staging
/shipdb sql SELECT COUNT(*) FROM "User" --env dev
```

If no `--env` flag is provided, queries default to **production**.

Non-prod results include an environment badge so you always know which database you're looking at.

Aliases: `production` → `prod`, `stg` → `staging`.

## Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App** → **From scratch**
2. Name it `ShipDB` (or whatever you prefer), select your workspace
3. Go to **Slash Commands** → **Create New Command**:
   - Command: `/shipdb`
   - Request URL: `https://YOUR-VERCEL-URL/api/slack/commands`
   - Short Description: `Query the ShipOS Pro database`
   - Usage Hint: `[stats | clients | client <name> | users | customers | packages | stores | search <term> | sql <query> | env] [--env dev|staging|prod]`
4. Go to **OAuth & Permissions** → add Bot Token Scopes:
   - `commands`
   - `chat:write`
5. Go to **Install App** → Install to Workspace
6. Copy the **Bot User OAuth Token** (`xoxb-...`)
7. Go to **Basic Information** → copy the **Signing Secret**

### 2. Deploy to Vercel

#### Option A: Deploy from GitHub (Recommended)

1. Push this repo to your GitHub org
2. Go to [vercel.com](https://vercel.com) → **New Project** → Import the repo
3. Add environment variables:
   - `DATABASE_URL_PROD` — Aurora PostgreSQL connection string for the production database
   - `DATABASE_URL_STAGING` — Aurora PostgreSQL connection string for the staging database
   - `DATABASE_URL_DEV` — Aurora PostgreSQL connection string for the dev database
   - `DATABASE_URL` — (Optional) Fallback for prod if `DATABASE_URL_PROD` is not set
   - `SLACK_BOT_TOKEN` — The `xoxb-...` token from step 1
   - `SLACK_SIGNING_SECRET` — From Slack App > Basic Information
   - `SQL_ALLOWED_USER_IDS` — (Optional) Comma-separated Slack user IDs who can run raw SQL
4. Deploy!
5. Update the Slash Command Request URL with your Vercel domain

#### Option B: Deploy with Vercel CLI

```bash
npm i -g vercel
vercel --prod
# Set environment variables in Vercel dashboard
```

### 3. Get Your Aurora Connection Strings

The ShipOS Aurora cluster hosts three databases on the same instance:

| Environment | Database | Env Var |
|-------------|----------|---------|
| Production | `shipos_prod` | `DATABASE_URL_PROD` |
| Staging | `shipos_staging` | `DATABASE_URL_STAGING` |
| Dev | `shipos_dev` | `DATABASE_URL_DEV` |

Connection string format: `postgresql://user:pass@aurora-host:5432/shipos_prod?sslmode=no-verify`

> **Note:** Use `sslmode=no-verify` for Aurora — `sslmode=require` will fail because Amazon's CA isn't in Node's trust store.

### 4. (Optional) Restrict Raw SQL Access

Set the `SQL_ALLOWED_USER_IDS` environment variable to a comma-separated list of Slack user IDs who should be allowed to run `/shipdb sql` queries.

To find a user's Slack ID: click their profile → ⋮ → Copy Member ID.

If left empty, all workspace members can run raw SQL queries (still restricted to SELECT only).

## Security

- **Read-only**: All queries are restricted to `SELECT` statements. The bot blocks `INSERT`, `UPDATE`, `DELETE`, `DROP`, and other write operations.
- **Signature verification**: All incoming requests are verified using the Slack signing secret.
- **Ephemeral responses**: Query results are only visible to the user who ran the command.
- **Optional SQL restriction**: Raw SQL can be limited to specific team members.
- **Environment isolation**: Each environment has its own database connection pool. No cross-env leakage.

## Architecture

```
Slack (/shipdb command)
  → Vercel Serverless Function (POST /api/slack/commands)
    → Parse command + --env flag + verify Slack signature
    → Select database pool (dev / staging / prod)
    → Query Aurora PostgreSQL via postgres.js (connection-pooled)
    → Format response with Slack Block Kit + environment badge
  → Slack (ephemeral message with results)
```

Uses `postgres` (postgres.js) for database queries with built-in connection pooling, connecting to Aurora PostgreSQL through RDS Proxy for efficient serverless operation. Each environment maintains its own connection pool (max 5 connections each).

## Local Development

```bash
npm install
cp .env.example .env.local  # Fill in your values (all 3 database URLs)
npm run dev
```

Use [ngrok](https://ngrok.com) to tunnel your local server for Slack:
```bash
ngrok http 3000
# Update the Slack slash command URL to your ngrok URL
```

## Database Schema Reference

Key tables (PascalCase, Prisma convention):

| Table | Description | Key Fields |
|-------|-------------|------------|
| `Tenant` | Clients (shipping stores) | name, slug, status, plan |
| `User` | Client users with roles | name, email, role, tenantId |
| `Customer` | End consumers / PMB holders | firstName, lastName, pmbNumber, tenantId |
| `Store` | Physical store locations | name, storeNumber, address, tenantId |
| `Package` | Packages in the system | trackingNumber, carrier, status, customerId |
| `Subscription` | Customer subscriptions | customerId, status, plan |
| `LoginSession` | Login tracking | userId, createdAt |
| `FranchiseGroup` | Multi-location groups | name, tenants |
| `Invoice` | Billing invoices | customerId, amount, status |

_Note: Table names are PascalCase. In raw SQL, quote them: `SELECT * FROM "Tenant"`_
