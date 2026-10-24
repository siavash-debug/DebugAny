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

The endpoint returns HTTP 202 after the event is persisted.

List recent grouped issues for a project:

```bash
curl http://localhost:4000/v1/events \\
  -H 'x-debugany-key: YOUR_INGESTION_KEY'
```

The response includes the project, total event count, and issues grouped by fingerprint from the most recent 500 events. This is an initial implementation; durable aggregation, pagination, and async queue processing remain follow-up work.

## Tests

```bash
npm test        # from the repo root
```

Unit tests for fingerprinting and metadata redaction always run. Integration tests exercise the real ingestion flow against Postgres when `DATABASE_URL` points at a reachable database (the local Docker instance or CI's service container) and are skipped otherwise.

## Security notes

- Store only a SHA-256 hash of ingestion keys.
- Never log or commit ingestion keys.
- Do not send secrets or personal data in metadata.
- This initial version is a development scaffold, not a hardened production ingestion service.
