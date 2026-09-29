# Book

Beauty-business booking SaaS (working title).

**Start here:** [`AGENTS.md`](./AGENTS.md) — product, stack, phases, and rules for humans & AI agents.

## Quick start (Phase 0)

```bash
cd book
cp .env.example .env
# Set DATABASE_URL + DIRECT_URL (Postgres) and JWT secrets
npm install
npx prisma migrate dev --name phase0
npm run dev:api          # :3001
npm run dev              # business app :3000
npm run dev:public       # public booking :3020
npm run dev:platform-admin  # :3010
```

Seed platform owner:

```powershell
$env:PLATFORM_OWNER_EMAIL="ops@example.com"
$env:PLATFORM_OWNER_PASSWORD="long-password-12"
npm run seed:platform-owner
```
