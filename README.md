# Prism — Shared Expenses Web App

**Prism** is a web-based shared expenses and personal finance application. Track group expenses, split bills, see who owes who, and settle up — all in your browser.

---

## Table of Contents

- [Stack](#stack)
- [Getting Started](#getting-started)
- [Supabase Setup](#supabase-setup)
- [Environment Variables](#environment-variables)
- [Database Migrations](#database-migrations)
- [Local Development](#local-development)
- [Cloudflare Pages Deployment](#cloudflare-pages-deployment)
- [Custom Domain](#custom-domain)
- [Project Structure](#project-structure)
- [What's Working](#whats-working)
- [What Needs Manual Setup](#what-needs-manual-setup)
- [Security Notes](#security-notes)

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML/CSS/TypeScript, Vite |
| Hosting | Cloudflare Pages |
| Database | Supabase Postgres |
| Auth | Supabase Auth (email/password) |
| API | Supabase client (browser) + Cloudflare Pages Functions (optional) |
| Domain | prismbudgeting.com (via Cloudflare) |

---

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- A [Supabase](https://supabase.com) account (free tier works)
- A [GitHub](https://github.com) account
- A [Cloudflare](https://cloudflare.com) account (free tier works)

### 1. Clone the repository

```bash
git clone https://github.com/your-username/prism.git
cd prism
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

See [Environment Variables](#environment-variables) for details.

### 4. Run locally

```bash
npm run dev
```

The app starts at **http://localhost:3000**.

---

## Supabase Setup

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in.
2. Click **New project**.
3. Choose a name (e.g., "prism"), set a secure database password, and select a region close to you.
4. Wait for the database to provision (~2 minutes).

### 2. Get your API credentials

In your Supabase project dashboard:

1. Go to **Project Settings → API**.
2. Copy the **Project URL** (looks like `https://xxxxx.supabase.co`).
3. Copy the **anon public** key (starts with `eyJ...`).
4. Optionally copy the **service_role** key for admin functions (keep this secret).

Add these to your `.env` file:

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key  # optional, keep secret
```

### 3. Run database migrations

In your Supabase dashboard:

1. Go to **SQL Editor**.
2. Open each migration file from `supabase/migrations/` in order:
   - `001_profiles.sql`
   - `002_groups.sql`
   - `003_expenses.sql`
   - `004_settlements.sql`
   - `005_invitations.sql`
   - `006_activity_logs.sql`
3. Copy the contents and paste into the SQL Editor.
4. Click **Run**.
5. Repeat for all migration files.

> **Note:** Migration files must be run in order because later tables reference earlier ones.

### 4. Configure Auth settings

In your Supabase dashboard:

1. Go to **Authentication → Providers**.
2. Make sure **Email** is enabled.
3. Under **Authentication → Settings**:
   - Set **Site URL** to `http://localhost:3000` (for local dev)
   - Add `http://localhost:3000` to **Redirect URLs**
   - For production, add your Cloudflare Pages URL

---

## Environment Variables

| Variable | Required | Where Used | Notes |
|----------|----------|------------|-------|
| `VITE_SUPABASE_URL` | Yes | Frontend (client) | Public, starts with `https://` |
| `VITE_SUPABASE_ANON_KEY` | Yes | Frontend (client) | Public anon key from Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Cloudflare Functions | **Secret.** Never expose in client code. |
| `APP_URL` | Yes | Auth redirects, invites | `http://localhost:3000` locally |
| `SITE_URL` | Yes | Supabase Auth config | Same as APP_URL for local dev |

### Security rules

- **Never** put `SUPABASE_SERVICE_ROLE_KEY` in frontend code.
- **Never** commit `.env` to git. Only `.env.example` is committed.
- The `VITE_` prefix makes Vite expose the variable to client code.

---

## Database Migrations

All migrations are in `supabase/migrations/`. Run them in order:

| File | Purpose |
|------|---------|
| `001_profiles.sql` | User profiles + auth trigger + RLS |
| `002_groups.sql` | Groups + group members + RLS |
| `003_expenses.sql` | Expenses + expense splits + RLS |
| `004_settlements.sql` | Settlements (payments between members) + RLS |
| `005_invitations.sql` | Invite links + RLS |
| `006_activity_logs.sql` | Activity/audit log + RLS |

Each file includes:
- `CREATE TABLE` statements
- `CREATE INDEX` for performance
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- RLS policies for data access control
- Triggers for `updated_at` column management

---

## Local Development

```bash
# Install dependencies
npm install

# Start dev server (hot reload)
npm run dev

# Build for production
npm run build

# Preview production build locally
npm run preview
```

### Windows compatibility

All commands work in PowerShell, CMD, and Git Bash on Windows.

---

## Cloudflare Pages Deployment

Deployments are expected to run from the `master` branch. If Cloudflare does not start a new build after a push, check the Pages project branch setting and GitHub integration webhook.

### 1. Connect your GitHub repository

1. Go to **Cloudflare Dashboard → Pages**.
2. Click **Create a project → Connect to Git**.
3. Authorize Cloudflare to access your GitHub account.
4. Select your Prism repository.

### 2. Configure build settings

| Setting | Value |
|---------|-------|
| **Framework preset** | None (or Vite) |
| **Build command** | `npm run build` |
| **Build output directory** | `dist` |
| **Root directory** | `/` |
| **Node.js version** | `18` or later |

### 3. Add environment variables

In Cloudflare Pages dashboard → your project → **Settings → Environment variables**:

| Variable | Value |
|----------|-------|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon key |
| `APP_URL` | `https://your-app.pages.dev` |
| `SITE_URL` | `https://your-app.pages.dev` |

### 4. Deploy

Cloudflare will automatically deploy when you push to your GitHub repository's main branch.

### 5. Add `_redirects` file

The `_redirects` file is already in the project root. It handles:
- Clean URLs (`/login` → `/login.html`)
- SPA fallback routing

---

## Custom Domain

To attach `prismbudgeting.com`:

1. Go to **Cloudflare Dashboard → Pages → your-project → Custom domains**.
2. Click **Set up a custom domain**.
3. Enter `prismbudgeting.com`.
4. Follow Cloudflare's DNS configuration instructions.
5. Update `APP_URL` and `SITE_URL` environment variables to `https://prismbudgeting.com`.
6. Update Supabase Auth settings with the new domain.

---

## Project Structure

```
prism/
├── _redirects                  # Cloudflare Pages routing
├── index.html                  # Marketing / landing page
├── login.html                  # Auth: log in
├── signup.html                 # Auth: sign up
├── forgot-password.html        # Auth: password reset
├── update-password.html        # Auth: set new password
├── dashboard.html              # App: user's groups
├── groups.html                 # App: group detail (expenses, balances, etc.)
├── invite.html                 # App: accept group invitation
├── package.json
├── tsconfig.json
├── vite.config.ts
├── .env.example
├── README.md
├── src/
│   ├── lib/
│   │   ├── supabaseClient.ts   # Supabase client singleton
│   │   ├── auth.ts             # Auth helpers (login, signup, logout, etc.)
│   │   ├── database.ts         # Profile CRUD + activity logging
│   │   ├── database.types.ts   # TypeScript types for all tables
│   │   ├── groups.ts           # Group CRUD + member management
│   │   ├── expenses.ts         # Expense CRUD + split calculations
│   │   ├── balances.ts         # Balance/debt/simplified settlement logic
│   │   ├── settlements.ts      # Settlement recording
│   │   └── invites.ts          # Invite link generation + acceptance
│   ├── styles/
│   │   └── app.css             # Shared app styles
│   └── main.ts                 # (reserved for future use)
├── supabase/
│   └── migrations/
│       ├── 001_profiles.sql
│       ├── 002_groups.sql
│       ├── 003_expenses.sql
│       ├── 004_settlements.sql
│       ├── 005_invitations.sql
│       └── 006_activity_logs.sql
└── public/                     # Static assets (images, etc.)
```

---

## What's Working

- **Authentication**: Signup, login, logout, password reset, session persistence.
- **Profiles**: Auto-created on signup via database trigger.
- **Groups**: Create, list, view details, add members.
- **Expenses**: Create with equal split, list by group, permission checks.
- **Balances**: Calculate who owes who, total owed/paid per member, simplified settlement suggestions.
- **Settlements**: Record payments between members.
- **Invites**: Generate invite links with unique tokens, accept invites, redirect unauthenticated users.
- **RLS**: Row Level Security on all tables. Users can only access data for groups they belong to.
- **TypeScript types**: Full type definitions matching the database schema.
- **Responsive CSS**: App pages work on mobile and desktop.
- **Cloudflare Pages ready**: Build config, `_redirects` file, environment variable setup.

---

## What Needs Manual Setup

| Task | Details |
|------|---------|
| **Supabase project** | Create in Supabase dashboard. Free tier works. |
| **Run migrations** | Copy/paste SQL files into Supabase SQL Editor. |
| **Configure Auth** | Set Site URL and Redirect URLs in Supabase Auth settings. |
| **Environment variables** | Create `.env` from `.env.example`, fill in values. |
| **Email sending** | Email confirmation and password reset emails require a Supabase email provider (free tier includes built-in email). No SMTP setup needed to start. |
| **Invite emails** | The invite system creates a link but does not send an email yet. You'll need to connect an email service or manually share invite links. |
| **Custom domain** | Requires Cloudflare DNS configuration. |

---

## Security Notes

- **Row Level Security** is enabled on all tables. Users cannot access data outside their groups.
- **Service role key** should never be used in client-side code. It's only for Cloudflare Functions if needed.
- **Environment variables** with `VITE_` prefix are exposed to client code. Do not put secrets there.
- **Supabase anon key** is safe to expose — RLS policies are the actual security layer.
- **Auth sessions** are managed by Supabase client — do not store auth tokens manually.
- **Input validation** happens in the helper functions and at the database level (CHECK constraints).

---

## License

MIT
