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
| API | Supabase client (browser) + Supabase RPC functions |
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
4. You do not need the **service_role** key for the current app.

Add these to your `.env` file:

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_APP_URL=http://localhost:3000
VITE_DEV_ADMIN_EMAIL=your-email@example.com
RESEND_API_KEY=your-resend-api-key
RESEND_FROM_EMAIL=Prism <noreply@prismbudgeting.com>
```

### 3. Run database migrations

In your Supabase dashboard:

1. Go to **SQL Editor**.
2. Open each numbered migration file from `supabase/migrations/` in order.
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
   - Add `http://localhost:3000/confirm-account` to **Redirect URLs**
   - For production, add your Cloudflare Pages URL

---

## Environment Variables

| Variable | Required | Where Used | Notes |
|----------|----------|------------|-------|
| `VITE_SUPABASE_URL` | Yes | Frontend (client) | Public, starts with `https://` |
| `VITE_SUPABASE_ANON_KEY` | Yes | Frontend (client) | Public anon key from Supabase |
| `VITE_APP_URL` | No | Auth redirects, invite links | Optional. If unset, the app uses the current browser origin. Set it when you want email links to use a specific domain. |
| `VITE_DEV_ADMIN_EMAIL` | No | Login helper | Optional. Must match a real, email-confirmed Supabase Auth user. This value is public because `VITE_` variables are exposed to the browser. |
| `RESEND_API_KEY` | Yes for invite email sending | Cloudflare Worker | Secret API key used to send invite emails. |
| `RESEND_FROM_EMAIL` | Yes for invite email sending | Cloudflare Worker | Verified sender address in Resend, for example `Prism <noreply@yourdomain.com>`. |

### Security rules

- **Never** commit `.env` to git. Only `.env.example` is committed.
- The `VITE_` prefix makes Vite expose the variable to client code.
- Do not store owner passwords or Supabase service role keys in frontend environment variables.
- Keep `RESEND_API_KEY` private. It should only live in local `.env` or Cloudflare environment variables.

### Developer owner access

Use `VITE_DEV_ADMIN_EMAIL` when you need one dependable development account that avoids repeated signup confirmation emails.

1. In Supabase, go to **Authentication -> Users**.
2. Create a user with the same email as `VITE_DEV_ADMIN_EMAIL`.
3. Mark the user's email as confirmed.
4. Set a password for that user in Supabase.
5. Log in normally at `/login` with that email and password.

This is not a fake login. The account still signs in through Supabase, so Row Level Security and normal database permissions continue to work.

### Invite emails

Prism now sends invite emails through [Resend](https://resend.com/), which is the simplest provider to wire up here.

1. Create a Resend account.
2. Verify a sender email or domain.
3. Set `RESEND_API_KEY` in your local `.env` file for app development.
4. Set `RESEND_API_KEY` in Cloudflare as a secret.
5. Keep `RESEND_FROM_EMAIL` in `wrangler.jsonc` under `vars` so Cloudflare does not remove it as dashboard drift.
6. For local worker testing with Wrangler, add `RESEND_API_KEY` to a local `.dev.vars` file.
7. In the group invite dialog, enter an email address before creating the invite.

The app still creates the shareable invite link, so you can copy it even if you choose not to email it.

### Receipt uploads

Prism stores receipt files in Supabase Storage and receipt details in the database.

1. Run `014_expense_receipts.sql` after the earlier migrations.
2. The migration creates a private Supabase Storage bucket named `receipts`.
3. If you create the bucket manually instead, make sure it is private and named exactly `receipts`.
4. Receipt uploads support images and PDFs up to 10 MB.

### Shared receipt workflow

The next database stage adds authenticated shared-receipt collaboration on top of the existing expense model.

1. Run `015_shared_receipt_workflow.sql` after `014_expense_receipts.sql`.
2. Receipt metadata now stores OCR/extraction state plus owner-adjustable tax, tip, service-charge, and discount allocation rules.
3. New `receipt_items` and `receipt_item_claims` tables support owner-managed line items with member-owned claim rows.
4. New `receipt_payment_methods` and `receipt_payment_requests` tables support direct repayment to the receipt owner without Prism moving money.
5. Row Level Security keeps receipt corrections, owner payment methods, and confirmations owner-only, while members can only change their own claims and their own payment-sent state.
6. The receipt workspace now lets owners manage PayPal, Venmo, Zelle, Cash App, or custom instructions, while members can safely copy/open instructions, mark payment sent, and view confirmation history.
7. Account-level payout profile groundwork is in `016_payout_profiles.sql`. It stores only masked receiving-account metadata; raw bank credentials require secure provider onboarding and are intentionally not stored by Prism.

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
| `007_fix_rls_recursion.sql` | Safe helper functions for RLS checks |
| `008_pure_link_invites.sql` | Link-based invite acceptance RPC |
| `009_guest_sessions.sql` | Guest session storage |
| `010_guest_invite_rpc.sql` | Browser-callable guest invite RPC |
| `011_security_hardening.sql` | Stricter member and payment permissions |
| `012_persistent_guest_accounts.sql` | Durable browser guest access + guest group membership |
| `013_owner_only_write_access.sql` | Owner-only edit permissions for groups, invites, expenses, and settlements |
| `014_expense_receipts.sql` | Private receipt uploads linked to expenses |
| `015_shared_receipt_workflow.sql` | Shared receipt line items, claims, allocation metadata, owner payment methods, and payment confirmation states |

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
| `VITE_DEV_ADMIN_EMAIL` | Optional developer owner email |
| `RESEND_API_KEY` | Resend API key for invite emails |
| `RESEND_FROM_EMAIL` | Verified Resend sender address |
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
5. Update `VITE_APP_URL` to `https://prismbudgeting.com`.
6. Update Supabase Auth settings and redirect URLs with the new domain, including `/confirm-account`.

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
- **Receipt workflow schema**: Owner-managed receipt extraction data, member item claims, direct payment-method profiles, and receipt-specific payment tracking are now modeled in the database.
- **Receipt workspace UI**: Group members can open a shared receipt workspace from the expenses tab. Owners can enter/correct line items manually, and members can claim or unclaim their own items with allocation previews.
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
| **Invite emails** | Invite emails are sent through Resend. You need to set a verified sender address and API key. |
| **Custom domain** | Requires Cloudflare DNS configuration. |

---

## Security Notes

- **Row Level Security** is enabled on all tables. Users cannot access data outside their groups.
- **Environment variables** with `VITE_` prefix are exposed to client code. Do not put secrets there.
- **Supabase anon key** is safe to expose — RLS policies are the actual security layer.
- **Auth sessions** are managed by Supabase client — do not store auth tokens manually.
- **Input validation** happens in the helper functions and at the database level (CHECK constraints).

---

## License

MIT
