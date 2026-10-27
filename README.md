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
