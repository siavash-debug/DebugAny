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

Health check: `GET http://localhost:4000/v1/health`

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

The endpoint returns HTTP 202 after the event is persisted. Async queue processing and issue aggregation are planned follow-up work.

## Security notes

- Store only a SHA-256 hash of ingestion keys.
- Never log or commit ingestion keys.
- Do not send secrets or personal data in metadata.
- This initial version is a development scaffold, not a hardened production ingestion service.
