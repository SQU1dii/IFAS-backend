# IFAS — Intelligent Financial Analytics System (Backend API)

Node.js/Express REST API for a multi-workspace financial analytics platform supporting Personal, Business, and Organisation workspaces. Includes JWT authentication with rotating refresh tokens, role-based access control, CSV/PDF transaction import, analytics, forecasting, anomaly detection, and an AI financial assistant.

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Runtime | Node.js 20+ | Non-blocking I/O, large ecosystem |
| Framework | Express 4 | Minimal, well-understood, composable middleware |
| Database | MySQL 8 + Knex | ACID compliance for financial data; parameterised queries; portable migrations |
| Auth | JWT + rotating refresh tokens | Stateless access tokens; refresh rotation lets logout actually revoke sessions |
| Password hashing | bcryptjs | Pure-JS, no native build required |
| Validation | Zod | Schema-first; great error messages; strips unknown keys |
| CSV import | csv-parse | Stream-capable, handles quoted fields |
| HTTP client | Axios | Calls the Python analytics service |
| Security | helmet, cors, express-rate-limit | Standard Express hardening |

---

## Prerequisites

- Node.js ≥ 20
- MySQL 8
- npm ≥ 10

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file (see Environment Variables section below)

# 3. Create the MySQL database
mysql -u root -p -e "CREATE DATABASE ifas CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 4. Run migrations and seed RBAC data
npm run db:setup

# 5. Start the development server
npm run dev
```

The API listens on `http://localhost:4000`.

---

## Environment Variables

Create a file called `.env` in this directory with the following variables:

```env
# Server
NODE_ENV=development
PORT=4000

# Comma-separated list of allowed CORS origins (must include your frontend URL)
CORS_ORIGIN=http://localhost:5173,http://localhost:5174

# Database (MySQL 8)
DB_CLIENT=mysql2
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=ifas
DB_USER=ifas
DB_PASSWORD=your_database_password
DB_CONNECTION_LIMIT=10

# Auth / JWT
# Use long random strings (minimum 32 characters each)
JWT_ACCESS_SECRET=replace-with-a-random-string-at-least-32-chars
JWT_REFRESH_SECRET=replace-with-a-different-random-string-32-chars
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_DAYS=7
BCRYPT_ROUNDS=12

# Analytics service (Python FastAPI on port 8001)
# Leave ANALYTICS_MODE=mock to use the built-in JS fallback (no Python needed)
ANALYTICS_SERVICE_URL=http://127.0.0.1:8001
ANALYTICS_TIMEOUT_MS=15000
ANALYTICS_MAX_RETRIES=2
ANALYTICS_MODE=mock

# AI assistant
# Leave AI_MODE=mock to use the built-in keyword-based mock (no API key needed)
AI_PROVIDER_URL=http://127.0.0.1:8002/v1/chat/completions
AI_PROVIDER_API_KEY=your_ai_provider_key
AI_PROVIDER_MODEL=ifas-assistant
AI_TIMEOUT_MS=30000
AI_MODE=mock

# Logging
LOG_LEVEL=info
```

> **Note:** `.env` is excluded from this repository. Never commit real secrets, passwords, or API keys to git.

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server with nodemon (auto-restart on file changes) |
| `npm start` | Start server without nodemon (production) |
| `npm run migrate` | Run pending database migrations |
| `npm run migrate:rollback` | Roll back the last migration batch |
| `npm run seed` | Run all seed files |
| `npm run db:setup` | Run migrations + seeds in one step |
| `npm test` | Run all tests (no MySQL needed) |
| `npm run test:unit` | Unit tests only |
| `npm run test:integration` | Integration tests only |
| `npm run mock:analytics` | Start mock FastAPI analytics server (port 8001) |
| `npm run mock:ai` | Start mock AI provider server (port 8002) |

---

## Project Structure

```
src/
├── server.js              # Entry point — creates app and starts listening
├── app.js                 # Express app setup: middleware, routes, error handler
│
├── config/
│   ├── constants.js       # All enums in one place: WORKSPACE_TYPES, ACCOUNT_TYPES,
│   │                      # PERMISSIONS, ROLES, ROLE_PERMISSIONS, DEFAULT_CATEGORIES
│   ├── database.js        # Knex instance with connection pool
│   ├── index.js           # Reads env vars, validates required ones, exports config
│   └── logger.js          # Pino JSON logger
│
├── middleware/
│   ├── authenticate.js    # Verifies JWT, attaches req.user
│   ├── loadMembership.js  # Verifies workspace membership, attaches req.membership
│   ├── requirePermission.js # Checks req.membership.permissions for required code
│   ├── validate.js        # Zod schema validation on req.body — returns 422 on failure
│   ├── errorHandler.js    # Maps errors to { error: { code, message, fields } }
│   └── notFound.js        # 404 handler for unmatched routes
│
├── routes/
│   ├── auth.routes.js         # /auth/*
│   ├── workspace.routes.js    # /workspaces, /workspaces/:id, members, departments
│   ├── financial.routes.js    # /transactions, /accounts, /categories
│   ├── import.routes.js       # /imports (preview + confirm)
│   ├── budget.routes.js       # /budgets, /goals
│   ├── dashboard.routes.js    # /dashboard
│   ├── analytics.routes.js    # /analytics/*
│   ├── intelligence.routes.js # /insights, /forecast, /anomalies, /alerts
│   └── report.routes.js       # /reports
│
├── controllers/           # Thin layer: validate → call service → format response
├── services/              # Business logic (never touches req/res)
├── repositories/          # Raw Knex queries (no business logic)
├── validators/            # Zod schemas for each endpoint
└── utils/
    ├── errors.js          # AppError class with HTTP status codes
    ├── asyncHandler.js    # Wraps async controllers to catch thrown errors
    ├── jwt.js             # Sign/verify/decode JWT helpers
    └── csvParser.js       # Shared CSV parsing logic

migrations/                # Knex migration files (create all 26 tables)
seeds/
  ├── seed.js              # RBAC: roles, permissions, role_permissions, category templates
  └── trainingData.js      # Optional: seeds 36 months of demo data for demo@ifas.dev
mocks/
  ├── analytics/           # Mock FastAPI analytics server (port 8001)
  └── ai/                  # Mock OpenAI-compatible AI server (port 8002)
tests/
  ├── lib/                 # In-memory Knex mock — no MySQL needed for tests
  ├── setup.js             # Jest global setup
  ├── unit/                # JWT, validators, permission logic
  └── integration/         # Auth, workspace, financial endpoints
```

---

## API Reference

All endpoints are prefixed with `/api/v1`. Full specification: `openapi.yaml`.

### Authentication (`/auth`)

```
POST /auth/register          Create account → { accessToken, user }
POST /auth/login             Login → { accessToken, user } + sets HttpOnly cookie
POST /auth/logout            Revoke refresh token + clear cookie
POST /auth/refresh           Rotate token pair using HttpOnly cookie
GET  /auth/me                Current user profile
PATCH /auth/me               Update name, email, currency, date format, theme
PATCH /auth/me/password      Change password
POST /auth/forgot-password   Send password reset link
POST /auth/reset-password    Set new password from token
```

### Workspaces (`/workspaces`)

```
GET    /workspaces                       List my workspaces (with my_role + my_permissions)
POST   /workspaces                       Create workspace (seeds default categories automatically)
GET    /workspaces/:id                   Workspace detail + my role + permissions
PATCH  /workspaces/:id                   Update name or currency

GET    /workspaces/:id/members           List members with roles
POST   /workspaces/:id/members           Invite member by email
PATCH  /workspaces/:id/members/:mid      Change role
DELETE /workspaces/:id/members/:mid      Remove member

GET    /workspaces/:id/departments       List departments (ORGANIZATION only)
POST   /workspaces/:id/departments       Create department
PATCH  /workspaces/:id/departments/:did  Update
DELETE /workspaces/:id/departments/:did  Delete
```

### Financial data (all workspace-scoped)

```
# Accounts
GET    /workspaces/:id/accounts          List (includes inactive)
POST   /workspaces/:id/accounts          Create
PATCH  /workspaces/:id/accounts/:aid     Update
DELETE /workspaces/:id/accounts/:aid     Soft-delete (is_active = false)

# Categories
GET    /workspaces/:id/categories        List (INCOME + EXPENSE)
POST   /workspaces/:id/categories        Create { name, type }
PATCH  /workspaces/:id/categories/:cid   Rename
DELETE /workspaces/:id/categories/:cid   Delete

# Transactions
GET    /workspaces/:id/transactions      List (paginated, filtered by type/category/account/date)
POST   /workspaces/:id/transactions      Create
GET    /workspaces/:id/transactions/:tid Detail
PATCH  /workspaces/:id/transactions/:tid Update
DELETE /workspaces/:id/transactions/:tid Hard delete
POST   /workspaces/:id/transactions/:tid/void  Soft-delete (status = VOID, kept for audit)

# CSV Import (two-step)
POST   /workspaces/:id/imports           Preview: validate rows, return errors
POST   /workspaces/:id/imports/:iid/confirm  Confirm: insert valid rows

# Budgets
GET    /workspaces/:id/budgets/status    List with spent/remaining/utilization/status
POST   /workspaces/:id/budgets           Create { category_id, limit, period }
PATCH  /workspaces/:id/budgets/:bid      Update
DELETE /workspaces/:id/budgets/:bid      Delete

# Savings Goals (PERSONAL workspaces)
GET    /workspaces/:id/savings-goals     List (enriched: progress_pct, days_remaining)
POST   /workspaces/:id/savings-goals     Create
PATCH  /workspaces/:id/savings-goals/:gid  Update
DELETE /workspaces/:id/savings-goals/:gid  Delete + cascade contributions

GET    /workspaces/:id/savings-goals/:gid/contributions  List history
POST   /workspaces/:id/savings-goals/:gid/contributions  Add contribution or withdrawal
```

### Analytics & Intelligence

```
GET /workspaces/:id/dashboard            Summary + charts + budgets + insights
GET /workspaces/:id/analytics/monthly    Month-by-month income/expenses/net
GET /workspaces/:id/analytics/categories Spending by category + trends
GET /workspaces/:id/analytics/cash-flow  Cumulative cash flow series
GET /workspaces/:id/analytics/budget-performance  Planned vs actual per budget
GET /workspaces/:id/analytics/savings-trends  Balance over time per goal

GET /workspaces/:id/insights             Rule-based financial insights
GET /workspaces/:id/forecast             3-month projection (requires 6+ months history)
GET /workspaces/:id/anomalies            Unusual transactions (z-score > 2)
GET /workspaces/:id/patterns             Per-category spending trends

GET /workspaces/:id/alerts               Open alerts
PATCH /workspaces/:id/alerts/:aid/review   Mark reviewed
PATCH /workspaces/:id/alerts/:aid/dismiss  Dismiss

GET /workspaces/:id/reports              Period financial summary
```

### AI Assistant

```
GET  /workspaces/:id/assistant/conversations        List conversations
GET  /workspaces/:id/assistant/conversations/:cid   Detail
POST /workspaces/:id/assistant/messages             Send message → { message, conversation_id }
```

---

## Response Format

All successful responses:
```json
{
  "success": true,
  "data": { ... },
  "meta": { "total": 100, "page": 1, "page_size": 15, "total_pages": 7 },
  "message": null
}
```

All error responses:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "fields": {
      "email": "Email is already registered",
      "amount": "Amount must be greater than 0"
    }
  }
}
```

---

## Database Schema

26 tables. Key design decisions:

- `transactions.amount` is always positive — `type` (INCOME/EXPENSE/TRANSFER) determines direction
- Transfers are excluded from income and expense totals in all aggregations
- All money stored as `DECIMAL(15,2)` — floating point is never used
- Composite foreign keys `(workspace_id, account_id)` → `accounts(workspace_id, id)` make cross-workspace references impossible at the database level
- `transactions.status` is POSTED or VOID — voided transactions are kept for audit trails
- Soft deletes on accounts (`is_active = false`) preserve transaction history

---

## Security

- **Workspace isolation** — every query is scoped by `workspace_id` from the verified membership, never from the request body
- **JWT rotation** — every `/auth/refresh` revokes the old token and issues a new pair. Logout revokes immediately
- **AI privacy** — only aggregated figures (totals, counts, percentages) are sent to the AI provider. Raw descriptions, account names, and member details never leave the server
- **Rate limiting** — auth endpoints: 20 req/15 min. AI assistant: 20 req/min
- **Parameterised queries** — Knex enforces parameterisation throughout; no raw SQL string interpolation

---

## Demo Data

To populate a demo environment with 36 months of realistic financial data:

```bash
node seeds/trainingData.js
```

Creates workspaces for `demo@ifas.dev` / `Demo1234!` with accounts, categories, departments, budgets, savings goals, and ~6,000 transactions. Required for meaningful forecast and anomaly detection testing.

---

## Running Without the Python Analytics Service

Set `ANALYTICS_MODE=mock` and `AI_MODE=mock` in `.env` (the default). The Express API runs equivalent logic in-process using JavaScript — no Python installation, no network calls to external services. All analytics, forecasting, anomaly detection, and AI assistant responses will work using the built-in mock implementations.
