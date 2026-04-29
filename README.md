# 📦 ShipDB Bot

A Slack bot for querying the ShipOS Pro database. Deployed on Vercel, connects to Neon PostgreSQL.

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
| `/shipdb help` | Show all commands |

All responses are **ephemeral** (only visible to the user who ran the command).

## Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App** → **From scratch**
2. Name it `ShipDB` (or whatever you prefer), select your workspace
3. Go to **Slash Commands** → **Create New Command**:
   - Command: `/shipdb`
   - Request URL: `https://YOUR-VERCEL-URL/api/slack/commands`
   - Short Description: `Query the ShipOS Pro database`
   - Usage Hint: `[stats | clients | client <name> | users | customers | packages | stores | search <term> | sql <query>]`
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
   - `DATABASE_URL` — Your Neon PostgreSQL connection string
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

### 3. Get Your Neon Connection String

1. Go to [console.neon.tech](https://console.neon.tech)
2. Select the `shipos-db` project
3. Click **Connection Details**
4. Copy the connection string (format: `postgresql://user:pass@host/db?sslmode=require`)

### 4. (Optional) Restrict Raw SQL Access

Set the `SQL_ALLOWED_USER_IDS` environment variable to a comma-separated list of Slack user IDs who should be allowed to run `/shipdb sql` queries.

To find a user's Slack ID: click their profile → ⋮ → Copy Member ID.

If left empty, all workspace members can run raw SQL queries (still restricted to SELECT only).

## Security

- **Read-only**: All queries are restricted to `SELECT` statements. The bot blocks `INSERT`, `UPDATE`, `DELETE`, `DROP`, and other write operations.
- **Signature verification**: All incoming requests are verified using the Slack signing secret.
- **Ephemeral responses**: Query results are only visible to the user who ran the command.
- **Optional SQL restriction**: Raw SQL can be limited to specific team members.

## Architecture

```
Slack (/shipdb command)
  → Vercel Serverless Function (POST /api/slack/commands)
    → Parse command + verify Slack signature
    → Query Neon PostgreSQL via @neondatabase/serverless (HTTP)
    → Format response with Slack Block Kit
  → Slack (ephemeral message with results)
```

Uses `@neondatabase/serverless` for HTTP-based database queries, which is ideal for Vercel's serverless environment (no persistent connections needed).

## Local Development

```bash
npm install
cp .env.example .env.local  # Fill in your values
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
