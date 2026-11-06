# IFAS — Intelligent Financial Analytics System (Backend API)

Node.js/Express REST API for a multi-workspace finance platform supporting
PERSONAL, BUSINESS and ORGANIZATION workspaces.

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Runtime | Node.js 20+ (LTS) | Fast, huge ecosystem, non-blocking I/O |
| Framework | Express 4 | Minimal, well-understood, rich middleware |
| ORM/Query | Knex + mysql2 | Parameterised queries by default; portable migrations; composite FKs work cleanly; no code-gen overhead |
| Auth | JWT (short-lived) + rotating refresh tokens (hashed in DB) | Stateless verification on every request; refresh rotation lets logout actually revoke sessions |
| Password hashing | bcryptjs | Pure-JS bcrypt-compatible; no native build required |
| Validation | Zod | TypeScript-friendly schema; great error messages; strips unknown keys |
| CSV import | multer + csv-parse | Standard multipart upload; stream-capable parser |
| HTTP client | Axios | Retry/timeout wrappers around the FastAPI analytics service |
| Security | helmet, cors, express-rate-limit | Standard Express hardening |
| Tests | Jest + Supertest + in-memory mock DB | Zero external services needed; full stack exercised |

---

## Prerequisites

- Node.js ≥ 20
- MySQL 8 (for production; tests use an in-memory mock — no DB needed)
- npm ≥ 10

---

## Quick Start

```bash
# 1. Clone and install
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env: DB_HOST, DB_NAME, DB_USER, DB_PASSWORD, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET

# 3. Create the MySQL database
mysql -u root -p -e "CREATE DATABASE ifas CHARACTER SET utf8mb4;"

# 4. Run migrations + RBAC seed
npm run db:setup

# 5. (Optional) Seed training data for all three workspace types
node seeds/trainingData.js
# Login: demo@ifas.dev / Demo1234!

# 6. Start the server
npm run dev     # nodemon (watch mode)
npm start       # production
```

---

## Environment Variables

Copy `.env.example` to `.env`. Required variables:

| Variable | Description | Example |
|---|---|---|
| `NODE_ENV` | `development` / `production` / `test` | `development` |
| `PORT` | HTTP port | `4000` |
| `CORS_ORIGIN` | Comma-separated allowed origins | `http://localhost:5173` |
| `DB_HOST` | MySQL host | `127.0.0.1` |
| `DB_PORT` | MySQL port | `3306` |
| `DB_NAME` | Database name | `ifas` |
| `DB_USER` | MySQL user | `ifas` |
| `DB_PASSWORD` | MySQL password | *(secret)* |
| `JWT_ACCESS_SECRET` | Access token signing secret (≥32 chars) | *(secret)* |
| `JWT_REFRESH_SECRET` | Refresh token signing secret (≥32 chars) | *(secret)* |
| `JWT_ACCESS_EXPIRES_IN` | Access token lifetime | `15m` |
| `JWT_REFRESH_EXPIRES_DAYS` | Refresh token lifetime in days | `7` |
| `BCRYPT_ROUNDS` | bcrypt cost factor | `12` |
| `ANALYTICS_SERVICE_URL` | Python FastAPI analytics service | `http://127.0.0.1:8001` |
| `ANALYTICS_MODE` | `mock` (default) or `live` | `mock` |
| `AI_PROVIDER_URL` | OpenAI-compatible chat completions URL | `http://127.0.0.1:8002/v1/chat/completions` |
| `AI_PROVIDER_API_KEY` | AI provider key | *(secret)* |
| `AI_MODE` | `mock` (default) or `live` | `mock` |
| `LOG_LEVEL` | `error` / `warn` / `info` / `debug` | `info` |

---

## Running Tests

```bash
# All tests (no MySQL needed — in-memory mock DB)
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration
```

The test suite uses a pure-JavaScript in-memory Knex-compatible mock
(`tests/lib/memoryKnex.js`) that enforces the same composite foreign-key
constraints as MySQL. No native dependencies, no database installation needed.

---

## Mock Services

For local development without a real Python analytics service or AI API key:

```bash
# Mock FastAPI analytics service (port 8001)
npm run mock:analytics

# Mock AI provider — OpenAI-compatible (port 8002)
npm run mock:ai
```

Both are controlled by `ANALYTICS_MODE=mock` and `AI_MODE=mock` in `.env`
(the default), which bypasses HTTP entirely and calls the in-process mock logic.

---

## API Overview

All endpoints are under `/api/v1`. Full spec: `openapi.yaml`.

### Authentication

```
POST /auth/register   → { user, access_token, refresh_token }
POST /auth/login      → { user, access_token, refresh_token }
POST /auth/logout     → revoke refresh token
POST /auth/refresh    → rotate token pair
GET  /auth/me         → current user
```

### Workspaces

```
GET    /workspaces                     list my workspaces
POST   /workspaces                     create workspace
GET    /workspaces/:id                 detail + my role + permissions
PATCH  /workspaces/:id                 update
GET/POST/PATCH/DELETE /workspaces/:id/members
GET/POST/PATCH/DELETE /workspaces/:id/departments  (ORGANIZATION only)
```

### Financial (all workspace-scoped)

```
/accounts      CRUD
/categories    CRUD
/transactions  list (paginated, filtered) · create · edit · void (never delete)
/imports       upload CSV → preview → confirm · rejected CSV download
/budgets       CRUD · GET /budgets/:id/status (% used)
/goals         CRUD  (PERSONAL workspaces only)
/alerts        list · PATCH /review · PATCH /dismiss
/dashboard     GET  (shaped by workspace type + role)
/reports       GET  (CSV download)
/forecast      GET  (≥6 months history required)
/recommendations  GET · POST /refresh · DELETE /:id
/assistant/messages           POST
/assistant/conversations      GET
/assistant/conversations/:id  GET
```

### Platform Admin

```
GET    /admin/users            list all users (no financial data)
PATCH  /admin/users/:id        deactivate / update
GET    /admin/audit-log        last 200 audit entries
```

---

## CSV Import Format

```
ref,date,description,amount,type,account,to_account,category,department
PER-000001,2026-01-15,Monthly salary,120000,INCOME,Bank Account,,Salary,
PER-000002,2026-01-05,House rent,28000,EXPENSE,Bank Account,,Rent,
PER-000003,2026-01-29,Monthly savings,10000,TRANSFER,Bank Account,Savings Account,,
```

- `ref`: optional external reference; ignored on import
- `date`: YYYY-MM-DD
- `amount`: positive number (sign carried by `type`)
- `type`: INCOME / EXPENSE / TRANSFER
- `account`: must match an existing account name in the workspace
- `to_account`: TRANSFER only
- `category`: required for INCOME/EXPENSE; must exist in the workspace
- `department`: ORGANIZATION workspaces; must exist

---

## Training Data Integration

The `IFAS_training_data/` folder contains 36 months of synthetic financial
data for all three workspace types. Run the training-data seeder to populate
a demo environment:

```bash
node seeds/trainingData.js
```

This creates three workspaces (PERSONAL, BUSINESS, ORGANIZATION) for
`demo@ifas.dev` with all accounts, categories, departments, budgets, savings
goals, and ~6 000 transactions pre-loaded — perfect for:

- Testing the `/forecast` endpoint (36 months of history)
- Exercising the unusual-spending detector
- Evaluating the AI assistant against `assistant_eval_questions.csv`

---

## Security Notes

1. **Workspace isolation** — every query is scoped by `workspace_id` taken
   from the verified membership, never from the request body.
2. **Composite foreign keys** — `transactions(workspace_id, account_id)` →
   `accounts(workspace_id, id)` makes cross-workspace references structurally
   impossible at the database level.
3. **AI provider privacy** — only aggregated figures (totals, counts,
   percentages) are sent to the AI provider. Raw descriptions, account names,
   and member details never leave the server.
4. **Refresh token rotation** — every `/auth/refresh` call revokes the old
   token and issues a new one. Logout revokes the token immediately.
5. **Rate limiting** — auth routes: 20 req / 15 min. Assistant: 20 req / min.
6. **Parameterised queries** — Knex enforces parameterisation; no raw SQL
   strings in application code.

---

## Project Structure

```
src/
  config/       index.js · database.js · logger.js · constants.js
  middleware/   authenticate.js · loadMembership.js · requirePermission.js
                validate.js · errorHandler.js · notFound.js
  routes/       auth · workspace · financial · import · budget
                dashboard · analytics · assistant · admin
  controllers/  auth · workspace · financial
  services/     auth · workspace · account · category · transaction
                import · budget · dashboard · analytics · assistant
  repositories/ user · token · audit · workspace · member · department
                role · category · account · transaction · alert
  validators/   auth · workspace · financial · budget
  utils/        errors · asyncHandler · jwt · csvParser

tests/
  lib/          memoryKnex.js (in-memory DB mock) · seed.js
  setup.js      Jest global setup (injects mock DB, seeds RBAC)
  unit/         jwt · authValidators · permissions
  integration/  auth · workspace · financial

mocks/
  analytics/    mockAnalyticsService.js  (Express, port 8001)
  ai/           mockAiProvider.js        (OpenAI-compatible, port 8002)

seeds/
  seed.js           RBAC + category templates (run by npm run db:setup)
  trainingData.js   IFAS training data seeder (run manually)

schema.sql    Authoritative MySQL 8 DDL
seed.sql      Authoritative MySQL seed (mirrors seeds/seed.js)
openapi.yaml  Full OpenAPI 3.1 specification
```

---

## Assumptions & Open Questions

See `ASSUMPTIONS.md`.
