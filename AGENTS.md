# Book — Canonical product & engineering guide

> **Read this file first** before changing code.  
> Any human developer or AI agent must treat this document as the source of truth for product intent, architecture, stack, phases, and coding conventions.  
> If implementation drifts from this file, **update this file in the same change** (or stop and ask).

**Working title:** Book (placeholder — rename later)  
**Repo folder:** `book/` under `addis tech`  
**Sibling reference:** `asana2-main` (TeamFlow) — reuse patterns, do **not** copy unrelated product UI.

---

## 1. What the product is

Book is a **low-cost, self-service B2B SaaS** for beauty and appointment businesses (salons, barbers, makeup, nails, lashes, spas, and similar).

It is **not** primarily a marketplace. Distribution is the business’s existing audience:

1. Business signs up → gets a public page `yourdomain.com/{slug}`
2. They put that link in Instagram / TikTok / Facebook / WhatsApp bio
3. Customer clicks → books (name, phone, optional email) — **no heavy customer account required**
4. Booking creates / updates a **per-business customer CRM** row
5. Owner manages calendar, staff, (later) branches, deposits, marketing, loyalty

### One-line pitch

> Self-serve booking + CRM + light ops for beauty businesses, shared via social bios — Free forever for basics; paid for staff, deposits, marketing, and branches.

### Three product pillars

| Pillar | Promise |
|--------|---------|
| Booking infrastructure | Let my customers book me online |
| Business management | Manage salon, staff, branches, revenue, customers |
| Customer growth | Bring those customers back (segments + campaigns) |

### Non-goals (for now)

- Building a discovery marketplace first
- Processing full card/mobile-money checkout as merchant-of-record in v1 (deposits are **verify-assisted**, not full PSP)
- Crypto payments
- Native mobile apps
- Microservices
- Feature bloat before the core loop works

### Core loop that must stay excellent

```text
Sign up → create business → pick slug → configure services/hours
→ share link → customer books → salon notified → visit happens
→ customer saved in CRM → salon can re-engage later
```

---

## 2. Architecture (same logic as TeamFlow)

**Style:** client–server at system level; layered inside the API (routes → domain → Prisma → Postgres).  
**Tenancy:** each **Business** is a tenant (like TeamFlow’s Workspace).

```text
                    YOUR PLATFORM
                         │
         ┌───────────────┼───────────────┐
         │               │               │
   Public booking   Business app    Platform admin
   /{slug}          app.*           admin.*
         │               │               │
         └───────────────┼───────────────┘
                         │
                   Express API
              /api/*  +  /platform/api/*
                         │
                 Prisma → PostgreSQL
```

| Surface | Audience | Deploy idea |
|---------|----------|-------------|
| `public-site` or path `/{slug}` | Customers | Same web service or static + API |
| Business dashboard (`src/`) | Owners / staff | Web service with API |
| `platform-admin/` | **Our** ops staff | Static site → API |
| Marketing landing (later) | Prospects | Static (Vercel/Render) |

**Hard rule:** Workspace/business “owner” ≠ platform OWNER. Separate `PlatformUser`, separate `PLATFORM_JWT_SECRET`, MFA for platform staff.

---

## 3. Tech stack (required unless this doc is updated)

| Layer | Choice |
|-------|--------|
| Language | TypeScript |
| Monorepo | Single package (like TeamFlow), nested Vite apps |
| Business UI | React 19 + Vite + React Router |
| Platform admin UI | React + Vite (`platform-admin/`) |
| Public booking UI | React + Vite (can share monorepo; public routes) |
| API | Express 5 |
| ORM / DB | Prisma 5 + PostgreSQL (Supabase in prod) |
| Auth product | JWT (`JWT_SECRET`) + bcrypt + email OTP |
| Auth platform | `PLATFORM_JWT_SECRET` + bcrypt + TOTP MFA |
| Email | Resend HTTPS API (`RESEND_API_KEY`, `EMAIL_FROM`) |
| Entitlements | Shared `server/entitlements/` module |
| Hosting | Render Web Service (API + business SPA) + Static Site (platform admin) |
| Files (later) | Supabase Storage or R2 for photos / deposit screenshots |

**Local ports (convention):**

| App | Port |
|-----|------|
| Business dashboard Vite | 3000 |
| API | 3001 |
| Platform admin Vite | 3010 |
| Public booking Vite (if separate) | 3020 |

---

## 4. Domain model (target; Phase 0 implements a subset)

### Tenancy & identity

- `User` — person who logs into the **business** app
- `Business` — tenant; unique `slug` for public URL
- `BusinessMember` — OWNER | MANAGER | STAFF
- `Subscription` — FREE | BUSINESS | PRO + seat/limits flags
- `PlatformUser` / `PlatformAuditLog` — our ops plane

### Presence & catalog (Phase 1+)

- `BusinessProfile` — about, photos, location, hours JSON
- `Service` — name, duration minutes, price ETB, active
- `StaffProfile` — linked member, bookable, services they offer
- `StaffSchedule` / time off
- `Branch` — Pro; Phase 4

### Booking & CRM

- `Customer` — **per business** (phone unique per business)
- `Appointment` — customer, service(s), staff?, start/end, status
- Notifications via email first; SMS/Telegram later

### Money (Phase 2)

- `DepositRequest` / `DepositSubmission` — amount, instructions, txn ref, screenshot URL, PENDING | VERIFIED | REJECTED  
  Owner verifies; platform does **not** move money in v1.

### Growth (Phase 3)

- Campaigns / segments (inactive 60d, loyal, by service, by branch)  
- Reuse TeamFlow compose/campaign patterns

### Entitlement keys (initial)

```text
booking_page, appointments, customers_basic,
staff_management, deposits, marketing, analytics,
branches, custom_branding
```

Limits examples: `maxStaff`, `maxBranches`, `maxBookingsPerMonth`, `marketingCreditsMonthly`.

**Downgrade rule:** Paid → Free **limits**, never destroy customer history.

---

## 5. Build phases

### Phase 0 — Skeleton (current)

- [x] Repo folder + this document
- [x] Monorepo scaffold (scripts, Prisma, Express, Vite apps)
- [x] Product signup with email OTP
- [x] Create business + choose unique slug
- [x] Ensure Free `Subscription` on business create
- [x] Empty public page at `/{slug}` showing business name
- [x] Business dashboard shell (logged-in home)
- [x] Platform admin: seed OWNER, password + MFA enroll, business search
- [x] CORS + env example + dual JWT secrets
- [x] `.env.example`, README quickstart

**Phase 0 remaining for you locally:** copy `.env.example` → `.env`, set Postgres URLs + secrets, `npm install`, `npx prisma migrate deploy`, run the four dev scripts, seed platform owner.

### Phase 1 — Bio-link that books (MVP)

Services, hours/profile, book form, create Customer + Appointment, owner list + email notify.

- [x] Schema: `Service`, `Customer`, `Appointment` + business profile fields
- [x] Owner API: services CRUD, profile patch, appointments + customers list
- [x] Public API: richer `GET /:slug`, `POST /:slug/bookings` (rate limited, Free monthly cap)
- [x] Email: notify owner (+ customer if email given)
- [x] Dashboard UI: services, upcoming bookings, customers, profile
- [x] Public UI: service list + book form

**Done when** a salon can put the link in Instagram and receive a real booking (after you wire Supabase + migrate).

### Phase 2 — Salon ops

Staff, availability engine, assign artist, dashboard metrics, deposit verify flow.

- [x] Schema: `StaffProfile`, `StaffService`, `StaffSchedule` + `staffProfileId` on `Appointment`
- [x] Staff API: CRUD profiles, assign services, set weekly schedule (entitlement-gated)
- [x] Appointment status: PATCH to CONFIRMED / COMPLETED / CANCELLED / NO_SHOW
- [x] Dashboard metrics: bookings, revenue, customer stats, top services
- [x] Dashboard UI: tab navigation (Overview, Services, Staff, Customers, Profile)
- [x] Public API: return bookable staff on `GET /:slug`, accept optional `staffProfileId` on booking
- [x] Public UI: show team, optional artist picker in booking form
- [ ] Availability engine: slot computation from hours/schedule minus existing appointments
- [ ] Deposit verify flow: `DepositRequest` / `DepositSubmission` models + API + UI

### Phase 3 — Growth

CRM segments, email campaigns; SMS when provider/credits exist.

### Phase 4 — Pro

Branches, advanced analytics, richer branding, automation.

**Rule:** Do not start Phase N+1 until Phase N checklist is honestly complete.

---

## 6. API conventions

| Prefix | Who |
|--------|-----|
| `/api/*` | Business users (product JWT) |
| `/platform/api/*` | Platform staff only (platform JWT + MFA) |
| Public read | e.g. `GET /api/public/businesses/:slug` — no auth |
| Public write | e.g. `POST /api/public/businesses/:slug/bookings` — rate limited |

- Always scope tenant data by `businessId` from membership / slug.
- Enforce entitlements **on the server**, not only in UI.
- Rate-limit auth and public booking endpoints.
- Never commit `.env`. Never put secrets in Vite `VITE_*` except public API base URLs.

---

## 7. Security baseline (copy TeamFlow lessons)

| Control | Purpose |
|---------|---------|
| bcrypt passwords | DB leak ≠ cleartext passwords |
| Product JWT | Session without resending password |
| Separate platform JWT secret | No privilege escalation from product token |
| Email OTP | Prove inbox on signup |
| Platform TOTP MFA | Protect ops console |
| Rate limits | Brute force / OTP spam (not full DDoS) |
| CORS allowlist | Only trusted browser origins |
| Audit log | Who suspended / changed plan / sent campaigns |

---

## 8. Coding conventions for agents

1. **Read this file + current Prisma schema** before large changes.  
2. Prefer small, phase-aligned PRs; no drive-by refactors.  
3. Match existing file layout under `server/`, `src/`, `platform-admin/`.  
4. When adding a paid feature, add entitlement key + gate in API in the same change.  
5. Customer-facing booking UX must stay simple (phone-first, Ethiopia-friendly copy).  
6. Currency default **ETB**; keep money fields as integers (cents/santim) or Decimal — pick one and stay consistent (prefer integer **santim** = ETB * 100).  
7. Do not invent marketplace features “for the pitch.”  
8. Update the Phase checklist in **this file** when a phase item ships.  
9. Commits: no Cursor co-author trailers if the human forbids them.  
10. Reference implementation patterns live in `../asana2-main` — adapt names (`Business` not `Workspace`) rather than copy-paste chat/payroll.

---

## 9. Environment variables

See `.env.example`. Minimum:

```text
DATABASE_URL=
DIRECT_URL=
JWT_SECRET=
PLATFORM_JWT_SECRET=
FRONTEND_URL=http://127.0.0.1:3000
PUBLIC_SITE_URL=http://127.0.0.1:3020
PLATFORM_ADMIN_URL=http://127.0.0.1:3010
RESEND_API_KEY=
EMAIL_FROM="Book <noreply@yourdomain.com>"
```

Platform seed:

```text
PLATFORM_OWNER_EMAIL=
PLATFORM_OWNER_PASSWORD=   # min 12 chars
npm run seed:platform-owner
```

---

## 10. How an agent should resume work

1. Open `AGENTS.md` (this file) → note current Phase checklist.  
2. `git status` / skim `prisma/schema.prisma` and `server/`.  
3. Implement only the **next unchecked Phase item**.  
4. Run locally: API `:3001`, business `:3000`, admin `:3010`, public `:3020`.  
5. Mark checklist items done in this file.  
6. Stop and summarize what shipped + what’s next.

---

## 11. Document history

| Date | Note |
|------|------|
| 2026-09-25 | Initial canonical guide + Phase 0 kickoff |
| 2026-09-25 | Phase 1 booking MVP (services, CRM, public book, emails) |
| 2026-09-27 | Phase 2 salon ops: staff, metrics, appt status, dashboard tabs |

---

## 12. Relationship to TeamFlow (`asana2-main`)

Reuse: monorepo layout, dual JWT, MFA platform admin, OTP email packing, entitlements resolver, CORS matrix, Resend, campaign/compose ideas, deploy mental model.  
Do not reuse: TeamFlow product screens, chat, payroll, Asana-like tasks — different vertical.
