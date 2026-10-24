# Debugany

**Every bug. One place.**

Debugany is an early-stage application observability platform for error tracking, service health, and actionable debugging insights.

## Current status

The repository now contains:
- A Next.js dashboard with real issue investigation pages (list, detail, resolve/reopen/ignore) and fully API-backed metrics
- A NestJS API with health/readiness endpoints, transactional error-event ingestion into durable issues, paginated/filterable issue queries, a metrics overview endpoint, structured error responses, and correlation IDs
- PostgreSQL persistence via Prisma with versioned migrations
- Vitest unit tests plus database-backed integration tests
- Docker Compose for local PostgreSQL and Redis
- CI that installs, migrates, typechecks, tests, and builds

**Current limitation:** Every number on the dashboard comes from the API; fabricated service-health/latency/affected-user metrics were removed. Ingestion is synchronous (no queue yet), the dashboard uses a single project ingestion key (no user accounts), and alert delivery is not implemented. See [docs/implementation-plan.md](docs/implementation-plan.md).

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

Useful checks:

```bash
npm test          # unit tests; integration tests run when Postgres is reachable
npm run typecheck # strict typecheck of API and dashboard
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
- API readiness (checks the database): http://localhost:4000/v1/health/ready

See [API setup](apps/api/README.md), [web setup](apps/web/README.md), and [architecture notes](docs/architecture.md).

## Roadmap

- [x] Initial data model and event ingestion endpoint
- [x] Responsive dashboard preview
- [x] Connect dashboard issue list and total event count to the API
- [x] Versioned migrations, readiness probe, structured errors, and CI tests
- [x] Persisted issues with durable grouping, status, and pagination
- [x] Real time-series and issue metrics on the dashboard (no simulated data)
- [ ] Add project management and safe key rotation
- [ ] Process events asynchronously
- [x] Issue resolution from the dashboard
- [ ] Add alert rules and notifications
- [ ] Add dashboard-user authentication, security checks, and deployment

## Security

This is an early development scaffold, not a production-ready monitoring service. Do not send real customer data or secrets. Validate deployment settings and security controls before exposing the API publicly.

## License

License decision pending.
