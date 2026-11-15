# Generic CRM

A self-contained demo CRM for a portfolio: a React SPA backoffice, a local Node API and an embedded SQLite database. No external services, no credentials, no cloud — clone, install, run.

## Prerequisites

- [Node.js](https://nodejs.org) **≥ 20 LTS** (tested with Node 20/22/24) and npm (bundled with Node).
- That's all. The native SQLite driver (`better-sqlite3`) ships prebuilt binaries for Windows, macOS and Linux on supported Node versions.

## Quick start

```bash
npm install
npm run dev
```

- SPA (backoffice): **http://localhost:5173**
- API (local server): **http://127.0.0.1:8787** — healthcheck at `GET /api/ping`

On the first start the server automatically creates, migrates and seeds the SQLite file at `db/data/crm.db` with a realistic demo dataset (6 companies, 12 contacts, 16 deals across every pipeline stage with full stage history, 16 linked activities, 5 owners). The seed is deterministic: a fresh database always contains exactly the same data.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Installs every workspace (SPA + server) with a single lockfile. |
| `npm run dev` | Starts the API (`:8787`) and the Vite dev server (`:5173`, proxies `/api`) together. |
| `npm test` | Runs the test suites: server unit + API smoke (real SQLite in a temp file) and SPA tests. |
| `npm run build` | Type-checks and builds both workspaces (`admin/dist`, `server/dist`). |
| `npm run reset` | Deletes the database file, re-runs migrations and re-seeds the demo data. |
| `npm run seed:volume` | Recreates the database with the volume dataset (10,000 contacts / 1,000 deals) used for performance testing. Never runs on startup. |
| `npm run bench` | Starts the API in-process and measures listing latency (p95, 200 requests) against `/api/contacts?pageSize=50` and `/api/deals/pipeline`. Run `npm run seed:volume && npm run bench`. |
| `npm run smoke` | End-to-end Playwright smoke (login → dashboard → deal detail → degraded assistant → ES/EN). See **Smoke E2E** below. |

## Smoke E2E (Playwright)

A single-spec end-to-end smoke of the whole app — demo login, the metrics dashboard, a deal detail with names and both read-only histories (stage + amount), the assistant's honest "not configured" state, and the ES/EN toggle. It runs locally on demand (there is no CI in this project) and is the pre-ship gate G4.

One-time setup per machine (~124 MB browser download, deliberately **not** part of `npm install` so a clean install stays fast):

```bash
npx playwright install chromium
```

Then, any time:

```bash
npm run smoke
```

What it does: resets the demo database to the deterministic seed, starts the API on port **8799** and the SPA on port **5199** (fixed smoke-only ports, chosen because 5173/5174 are often taken by other apps on demo machines), runs the spec headlessly, and always kills both process trees afterwards (`taskkill /T` on Windows). The smoke server runs with an empty `CRM_LLM_API_KEY`, so the assistant step asserts its degraded "not configured" state even if a real key lives in `.env`. The smoke is separate from `npm test`.

Optional: set the `PORT` env var to change the API port (default `8787`), or `SESSION_SECRET` to change the signing secret of the demo session cookie (a safe demo default is embedded — this is a passwordless portfolio demo, not real auth). See `.env.example`.

## Assistant (chat over your data)

The backoffice ships with an optional AI assistant (`POST /api/chat`) that answers questions about the live CRM data in plain language — pipeline counts, biggest deal, company context. It translates the question into read-only SQL over the same SQLite file and answers from the actual rows, so every figure can be cross-checked against the Deals view. Multi-turn memory lives in the page: the client re-sends the last messages, nothing is persisted.

To enable it, copy `.env.example` to `.env` and set:

| Variable | Default | What it does |
|---|---|---|
| `CRM_LLM_API_KEY` | — (assistant off) | API key. Without it the chat returns an honest "not configured" reply with setup steps and the CRM keeps working normally. |
| `CRM_LLM_BASE_URL` | `https://api.openai.com/v1` | Any OpenAI-compatible `/chat/completions` endpoint. |
| `CRM_LLM_MODEL` | `gpt-4o-mini` | Model name at that endpoint. |

Compatible providers: any endpoint implementing the OpenAI chat-completions protocol **with standard tool-calling** — known to work: OpenAI, OpenRouter, Groq, Together, vLLM and a local Ollama (`CRM_LLM_BASE_URL=http://localhost:11434/v1`). Switching provider = two env vars, zero code. Endpoints without tool-calling are not supported.

Safety rails (by construction, not by prompt): the agent's SQL runs on a separate read-only connection — single `SELECT` only (no `PRAGMA`/`ATTACH`/multi-statement/`WITH RECURSIVE`), hard cap of 50 rows; every LLM call has a 15 s timeout; a turn is capped at 4 LLM calls and 3 tool runs; each session gets 10 chat requests per minute. Typical cost with a mini-class model: about $0.002–0.01 per question — a full demo session stays well under $0.50.

In the backoffice the assistant lives at **Chat IA / AI Chat** in the sidebar: the conversation stays in the page (nothing is persisted), suggested questions work in both languages, and every answer carries a collapsible “View agent query” section showing the exact SQL/search it ran with row counts and timings — so any figure can be checked against the Deals view. Without a key, the chat shows an honest “not configured” reply with setup steps and the CRM keeps working normally.

## Demo login

There are no credentials: type any name (or nothing) and you are in as that name — the session lives in a signed HttpOnly cookie (`POST /api/auth/login`). Sign out from the sidebar and come back under another name.

## Data and reset

The database lives in `db/data/crm.db` (gitignored). To start from scratch, run `npm run reset`: it deletes the file, re-runs every migration and re-seeds the demo data — because the seed is deterministic, the result is byte-for-byte the same dataset every time.

## Features

- **Metrics dashboard** — the first screen of the backoffice: pipeline value by stage (CSS/SVG bars, zero chart libraries), win rate, open deals and an 8-week activity breakdown by type, plus the top 5 companies by open value (`GET /api/metrics`, every figure computed server-side from live data).
- **Global search** — one search box in the layout searches contacts, companies and deals at once; results come back grouped with relevance scores and navigate to full detail pages (contacts and companies get their own read-only detail view).
- **Deal amount audit trail** — every amount change on a deal is recorded in the same transaction that updates it (who, when, from → to) and shown as a read-only "Amount history" next to the stage history in the deal detail. There is no API route that can edit or delete an audit entry.
- **CSV export** — the Contacts and Deals lists have an "Export CSV" button: `GET /api/export/contacts|deals` streams every active record as RFC 4180 CSV (UTF-8 with BOM, CRLF) that opens cleanly in Excel/LibreOffice. Round-trip verified against a standard CSV parser, hostile values included (quotes, commas, newlines, accents, emoji).
- **AI assistant over your data** — see **Assistant** below: natural-language questions answered with read-only SQL against the same SQLite file, with the exact query shown under every answer.

## Quick verification

```bash
npm test          # 237 unit/API tests
npm run smoke     # E2E Playwright (after: npx playwright install chromium)
```

## Project layout

```
admin/            SPA (React 18 + Vite + Tailwind + React Query + React Router)
server/           API (Hono on Node, zod validation, better-sqlite3)
db/migrations/    Numbered SQL migrations (applied automatically on start)
db/data/          SQLite file (created on first run, gitignored)
```

## Glossary (plain language)

- **Contact** — a person you sell to: name, email, phone, job title.
- **Company** — the organization a contact or a deal belongs to.
- **Deal** — a sales opportunity: a title, an amount of money, and the company and person involved.
- **Stage** — where a deal is in the sales path: `nuevo` (new) → `calificado` (qualified) → `propuesta` (proposal), ending in `ganado` (won) or `perdido` (lost).
- **Owner** — the user responsible for a deal.
- **Activity** — a logged task with a contact or a deal: a call, an email, a meeting or a to-do.
