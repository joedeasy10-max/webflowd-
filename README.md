# Webflow'd — AI Admin Assistant

An autonomous AI admin assistant / virtual receptionist for UK trade businesses
(plumbers, electricians, roofers, builders). Business owners connect their
calendar and inbox, fill in a profile, and the AI answers customer enquiries and
books jobs across channels — without the owner touching it.

- **Plan & design:** [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- **Stable context for contributors / AI sessions:** [`CLAUDE.md`](./CLAUDE.md)

## Status

**Phase 1 — Foundations & onboarding** (complete): multi-tenant schema +
migrations, AES-256-GCM token crypto, tenancy guard + Postgres RLS, append-only
audit log, Auth0 JWT verification, tenant provisioning, business-profile CRUD API,
and the Auth0-gated onboarding UI. See `ARCHITECTURE.md` §9 for the phase plan.

## Stack

Netlify Functions (TypeScript, Node 22) · Neon Postgres + Drizzle ORM · Inngest
(jobs) · Anthropic API (tool use) · Auth0 · Twilio / Gmail / SendGrid / Google &
Microsoft Calendar / Stripe · Zod · Vitest · Luxon (`Europe/London`).

## Layout

```
packages/shared    # zod schemas + shared types
packages/core      # db, tenancy, crypto, audit, security, repos
packages/web       # signed-in onboarding UI (Vite, vanilla TS)
netlify/functions  # api-* (Auth0 JWT) endpoints
```

## Develop

```bash
pnpm install
cp .env.example .env      # fill in real values (never commit .env)
pnpm typecheck            # tsc --noEmit across workspaces
pnpm test                 # vitest across workspaces
pnpm db:generate          # new migration from schema changes
pnpm db:migrate           # apply migrations (needs DATABASE_URL_UNPOOLED)
```

All secrets are documented in [`.env.example`](./.env.example).
