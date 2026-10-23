# Debugany

**Every bug. One place.**

Debugany is an early-stage application observability platform for error tracking, service health, and actionable debugging insights.

## Current status

The repository now contains:
- A Next.js dashboard with responsive UI, API-backed issue list, and clearly labeled sample-only charts/metrics
- A NestJS API with a health endpoint and validated error-event ingestion
- PostgreSQL persistence via Prisma
- Docker Compose for local PostgreSQL and Redis
- Initial architecture notes and CI metadata checks

**Current limitation:** The dashboard reads the issue list and total event count from the API when configured, but chart bars, service health, affected-user counts, and response-time metrics are still illustrative. The ingestion endpoint persists events synchronously; background queue processing, dashboard-user authentication, alert delivery, and production hardening remain planned.

## Stack

- Web: Next.js, React, TypeScript
- API: NestJS, TypeScript, REST
- Database: PostgreSQL, Prisma
- Background jobs (planned): Redis and BullMQ
- Local infrastructure: Docker Compose
- Automation: GitHub Actions

## Quick start

Requirements: Node.js 20+, npm, and Docker Compose.

```bash
cp apps/api/.env.example apps/api/.env
docker compose up -d postgres redis
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
```

Run the API in one terminal:

```bash
npm run dev:api
```

Run the dashboard in another terminal:

```bash
npm run dev:web
```

- Dashboard: http://localhost:3000
- API health: http://localhost:4000/v1/health

See [API setup](apps/api/README.md), [web setup](apps/web/README.md), and [architecture notes](docs/architecture.md).

## Roadmap

- [x] Initial data model and event ingestion endpoint
- [x] Responsive dashboard preview
- [x] Connect dashboard issue list and total event count to the API
- [ ] Replace sample charts and service metrics with real time-series data
- [ ] Add project management and safe key rotation
- [ ] Process events asynchronously and group issues
- [ ] Add issue resolution, alert rules, and notifications
- [ ] Add integration tests, security checks, and deployment

## Security

This is an early development scaffold, not a production-ready monitoring service. Do not send real customer data or secrets. Validate deployment settings and security controls before exposing the API publicly.

## License

License decision pending.
