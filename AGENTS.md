<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project rules

Read `docs/decisions.md`, `docs/data-model.md` and `docs/technical-plan.md` before changing behaviour. The product playbook (`docs/Book_Product_Playbook.docx`, with a searchable copy in `docs/playbook.txt`) is the source of truth; decisions are referenced by number (D01 to D99) and features by ID (F01 to F67).

- No user-facing text in components. All text lives in `src/messages/en.json` (F06).
- Format every time with `formatTime` / `formatDateTime` from `src/lib/time.ts`, so AM/PM is always shown (D87). Gregorian dates only (D86).
- Store money as integer minor units (santim) with a currency (`src/lib/money.ts`).
- Normalise phone numbers with `normalisePhone` from `src/lib/phone.ts` before storing or matching (D92).
- Store instants as `timestamptz` in UTC.
- Business-owned data is only read or written through the scoped data layer, never by querying business tables directly (`docs/technical-plan.md`, Section 3).
- Schema changes go through Drizzle migrations (`npm run db:generate`). Database rules that Drizzle cannot express (exclusion constraints, extensions) go in custom SQL migrations.
- Run `npm test`, `npm run typecheck` and `npm run lint` before committing.
