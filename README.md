# Book

Booking, customer management and growth for beauty businesses (working name).

Product documents live in `docs/`, which is kept out of git because this repository is public:

- Product: `docs/Book_Product_Playbook.docx`
- Decisions since the playbook: `docs/decisions.md`
- Database design: `docs/data-model.md`
- Stack and how the hard parts work: `docs/technical-plan.md`

## Requirements

- Node.js 22
- Docker Desktop (for the local Postgres database)

## First-time setup

```bash
npm install
cp .env.example .env
npm run db:up        # starts Postgres 18 in Docker
npm run db:migrate   # applies migrations to the development database
```

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Starts the app at http://localhost:3000 |
| `npm test` | Runs all tests (migrates the test database first) |
| `npm run typecheck` | Checks TypeScript types |
| `npm run lint` | Runs ESLint |
| `npm run db:generate` | Creates a migration from schema changes in `src/db/schema` |
| `npm run db:migrate` | Applies pending migrations |
| `npm run db:studio` | Opens a browser view of the database |

## Login (local)

Email and password work with no extra setup. Open http://localhost:3000/signup.

Google and Telegram buttons appear only when you fill the matching variables in `.env` (see `.env.example`). Telegram also needs an HTTPS domain registered with BotFather, so for local testing use a tunnel such as ngrok, or stick to email for now.

## Deploying (Render)

`render.yaml` describes one web service and one Postgres 18 database in Frankfurt.

1. In Render: **New > Blueprint**, connect GitHub and pick this repository.
2. Render creates the database and the web service and generates `SESSION_SECRET`.
3. If Render gives the service an address other than `https://bookbeauty.onrender.com`, update `APP_URL` in the service's environment.
4. Each deploy runs `npm run db:deploy` (pending migrations) before starting. New commits deploy only after the GitHub checks pass.

Email (`RESEND_API_KEY`, `EMAIL_FROM`), bot protection, Google and Telegram keys are entered in the Render dashboard. Without Resend, signup works but password reset emails cannot be sent.

### Addresses

Set `SITE_URL` (main domain, public pages), `APP_URL` (login and dashboard) and `ADMIN_URL` (admin area) to three addresses that all point at this service, for example `https://example.com`, `https://app.example.com` and `https://admin.example.com`. Left unset, `SITE_URL` and `ADMIN_URL` default to `APP_URL` and everything is served from one address. Rebuild after changing them. Each address needs a Google return address (`<address>/api/auth/google/callback`) and a Turnstile hostname; the Telegram bot's website is the app address.
