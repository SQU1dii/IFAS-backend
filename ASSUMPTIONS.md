# IFAS Backend — Assumptions & Open Questions

## Assumptions Made

### Architecture
1. **No bank / M-Pesa integration** — data enters only via manual entry and CSV import, as specified.
2. **ORM choice: Knex + mysql2** — chosen over Prisma (Prisma fights composite FKs and workspace-scoped queries) and over raw mysql2 (too much boilerplate). Knex gives portable migrations, parameterised queries by default, and first-class composite foreign keys.
3. **bcryptjs** (pure-JS) is used instead of native `bcrypt` because Node 24 lacks prebuilt native binaries for `bcrypt` on Windows without Visual Studio C++ build tools. The hashes are fully bcrypt-compatible.
4. **In-memory mock DB for tests** — `tests/lib/memoryKnex.js` implements the Knex query-builder API subset used by IFAS repositories in pure JavaScript. This lets the full Express stack (including middleware, permission checks, and workspace isolation) be exercised with Supertest without MySQL or any native dependency.

### Auth
5. **Access tokens: 15 minutes** (configurable). Short enough to limit exposure if stolen; the client uses the refresh token to silently renew.
6. **Refresh tokens: 7 days** (configurable), stored as SHA-256 hash in the DB so a stolen database dump cannot replay tokens.
7. **Logout revokes only the supplied refresh token** (single-device). A platform-admin "deactivate user" action can revoke all sessions.
8. **No email verification** is implemented — this is left for the frontend to handle (out of scope for the API assignment).

### Workspace Rules
9. **PERSONAL workspaces**: the owner is the only valid member role. Adding other PERSONAL Owner members is allowed (for shared personal finances) but no sub-roles exist.
10. **Savings goals** are enforced as PERSONAL-only in the service layer (not at the DB level) because the schema allows the table to exist for any workspace for future extension.
11. **Departments** are enforced as ORGANIZATION-only in the service layer.
12. **Department Head scoping** — a Department Head can only view/create/edit transactions where `department_id = their department`. This is enforced in the service layer, not via a DB constraint.

### Transactions
13. **Transactions are never deleted** — only voided. The `status = 'VOID'` field is permanent; voided transactions stay in the database for audit purposes.
14. **TRANSFER transactions** are not counted as income or expense in dashboards and reports. They have no `category_id`.
15. **Duplicate detection for CSV import**: same `(txn_date, amount, account_id, description)` combination already in the workspace as a POSTED transaction.

### Analytics
16. **Minimum 6 months of history** is required for forecast. Below this, a clear "insufficient data" response is returned (not an error).
17. **Only aggregated figures** are sent to the AI provider: totals, percentages, counts. No raw descriptions, account names, or member names.
18. **Analytics service timeout**: 15 seconds. After `ANALYTICS_MAX_RETRIES` retries with exponential back-off, a 503 "service unavailable" is returned. All other endpoints keep working.
19. **Training data** from `IFAS_training_data/` is loaded via the manual seeder `seeds/trainingData.js`. It is not loaded automatically to keep the production database clean.

### Security
20. **HTTPS is not terminated by the Node server** — the expectation is a reverse proxy (nginx, AWS ALB) handles TLS. The server is HTTPS-*ready* (helmet, cors, trust proxy in production).
21. **Platform Administrator** has zero financial-data permissions by design. They can manage user accounts and view the audit log only.

---

## Open Questions

1. **Multi-currency conversion** — the schema stores `currency` on the workspace but no exchange-rate service is integrated. All amounts are stored in the workspace's native currency. Cross-currency comparison is out of scope.

2. **PDF reports** — the spec says "PDF if time allows". Only CSV is currently implemented. Adding PDF would require `pdfkit` or `puppeteer`.

3. **Real-time budget alerts** — alerts are recalculated synchronously after each transaction and import but are not pushed to connected clients. A WebSocket or SSE layer could be added.

4. **Email notifications** — no email is sent for alerts or imports. Integration with SendGrid/SES is a future concern.

5. **Workspace deletion** — there is no `DELETE /workspaces/:id` endpoint. Soft-delete or a full cascade delete with audit logging would need a separate design decision.

6. **Pagination strategy for transactions** — cursor-based pagination (keyset) would be more efficient than offset pagination for large datasets, but offset is simpler for the client and sufficient for the data sizes in this project.

7. **AI provider model** — `AI_PROVIDER_MODEL` defaults to `ifas-assistant`. The actual model name (e.g., `gpt-4o-mini`) needs to be set in production. The mock accepts any model name.

8. **Unusual-spending scan on import** — after a confirmed import the scan is requested asynchronously (`setImmediate`). If the analytics service is down, the import still succeeds and no error is shown to the user. A retry queue (e.g., BullMQ) could be added.

9. **OpenAPI spec hosting** — the spec is in `openapi.yaml`. It can be served interactively via `swagger-ui-express` by mounting it at `/api/docs`. This is not currently wired up to keep the default install minimal.

10. **`csv-stringify` for reports** — the reports route attempts to use `csv-stringify/sync`. If the package is missing the route falls back to JSON. Run `npm install csv-stringify` to enable CSV downloads.
