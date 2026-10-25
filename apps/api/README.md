# Debugany API

NestJS REST API for project-scoped error event ingestion.

## Requirements

- Node.js 20+
- Docker Compose
- npm

## Run locally

From the repository root:

```bash
cp apps/api/.env.example apps/api/.env
docker compose up -d postgres redis
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev:api
```

The seed command creates a demo project and prints its ingestion key once. Keep that key private.

The API loads `apps/api/.env` automatically (the seed script does too), so exporting `DATABASE_URL` by hand is not required.

Health: `GET http://localhost:4000/v1/health` (liveness)
Readiness: `GET http://localhost:4000/v1/health/ready` (pings the database; returns 503 when it is down)

Every failed request returns a consistent envelope with a correlation id that is also sent back as the `x-request-id` response header, e.g.:

```json
{ "statusCode": 401, "error": "UNAUTHORIZED", "message": "Invalid ingestion key.", "correlationId": "…", "timestamp": "…" }
```

Ingestion bodies are limited to 64 KB. Metadata is recursively redacted for sensitive-looking keys (`password`, `token`, `apiKey`, …) and capped at 8 KB; oversized metadata is rejected with HTTP 400.

Ingest an event:

```bash
curl -X POST http://localhost:4000/v1/events \
  -H 'content-type: application/json' \
  -H 'x-debugany-key: YOUR_INGESTION_KEY' \
  -d '{
    "message": "Payment provider timed out",
    "errorType": "TimeoutError",
    "environment": "development",
    "release": "0.1.0",
    "metadata": { "service": "checkout" }
  }'
```

The endpoint returns HTTP 202 after the event **and its issue aggregate are committed** in one transaction — a 202 always means the event is durably stored. Matching events (same error type, message, and first three stack frames) are grouped into a persisted issue; a RESOLVED issue reopens when the same error recurs.

List issues (paginated and filterable):

```bash
curl "http://localhost:4000/v1/issues?status=UNRESOLVED&limit=25&offset=0" \
  -H 'x-debugany-key: YOUR_INGESTION_KEY'
```

Query parameters: `status` (`UNRESOLVED` | `RESOLVED` | `IGNORED`), `environment`, `search` (case-insensitive title match), `limit` (1–100, default 25), `offset`, `since`, `until` (ISO timestamps on `lastSeenAt`). The response includes `total`, `totalEvents`, and the project.

Issue detail with grouped event history:

```bash
curl "http://localhost:4000/v1/issues/ISSUE_ID?limit=25&offset=0" \
  -H 'x-debugany-key: YOUR_INGESTION_KEY'
```

Change issue status:

```bash
curl -X PATCH "http://localhost:4000/v1/issues/ISSUE_ID/status" \
  -H 'content-type: application/json' \
  -H 'x-debugany-key: YOUR_INGESTION_KEY' \
  -d '{"status": "RESOLVED"}'
```

Accepted statuses: `UNRESOLVED`, `RESOLVED`, `IGNORED`. Issues from another project are never reachable — every query is scoped to the authenticated ingestion key's project.

## Tests

```bash
npm test        # from the repo root
```

Unit tests for fingerprinting and metadata redaction always run. Integration tests exercise the real ingestion flow against Postgres when `DATABASE_URL` points at a reachable database (the local Docker instance or CI's service container) and are skipped otherwise.

## Authentication and projects (Phase 5)

- `POST /v1/auth/register` `{email, password, name}` → 201 with a session token (rate limited to 10/min per IP)
- `POST /v1/auth/login` `{email, password}` → 200 with a session token
- `POST /v1/auth/logout`, `GET /v1/auth/me` — require `Authorization: Bearer <session>`
- Sessions are opaque 256-bit tokens stored as SHA-256 hashes with 30-day expiry; passwords use Argon2id
- `GET /v1/projects`, `POST /v1/projects` — project list/create; creators become OWNER
- `GET|PATCH|DELETE /v1/projects/:projectId` — member-only (update/delete: owner-only)
- `GET|POST /v1/projects/:projectId/keys` — list/create ingestion keys (raw key returned exactly once)
- `POST /v1/projects/:projectId/keys/:keyId/rotate` — owner-only atomic rotation
- `DELETE /v1/projects/:projectId/keys/:keyId` — revoke; revoked and rotated-away keys fail ingestion immediately
- Issue and metric reads live under `/v1/projects/:projectId/issues` and `/v1/projects/:projectId/metrics/overview`
- Every project-scoped query resolves through project membership; cross-tenant access returns 404

Sensitive actions (project create/update/delete, key create/rotate/revoke, issue status changes) are recorded in the append-only `AuditLog` table, which intentionally has no foreign keys and survives project deletion.

## Security notes

- Store only a SHA-256 hash of ingestion keys.
- Never log or commit ingestion keys.
- Do not send secrets or personal data in metadata.
- This initial version is a development scaffold, not a hardened production ingestion service.
