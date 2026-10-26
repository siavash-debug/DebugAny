# Debugany

**Every bug. One place.**

Debugany is an early-stage application observability platform for error tracking, service health, and actionable debugging insights.

## Current status

The repository now contains:
- A Next.js dashboard behind user authentication (Argon2id passwords, httpOnly server-side sessions) with project switching, ingestion-key management, issue investigation pages, and fully API-backed metrics
- A NestJS API with user accounts and DB-backed sessions, project membership with owner/member roles, revocable per-project ingestion keys (hash at rest), transactional error-event ingestion into durable issues (inline or via BullMQ queue), alert rules with cooldowns, signed webhook deliveries with SSRF protections, paginated/filterable issue queries, a metrics overview endpoint, rate-limited auth endpoints, an audit log, and structured error responses
- PostgreSQL persistence via Prisma with versioned migrations
- Vitest unit tests plus database-backed integration tests
- Docker Compose for local PostgreSQL and Redis
- CI that installs, migrates, typechecks, tests, and builds

**Current limitation:** Every number on the dashboard comes from the API; fabricated metrics were removed. Users cannot invite collaborators yet (members are added via the API for now), queue delivery is at-least-once (not exactly-once), webhook destinations must be publicly resolvable at creation time, and email notifications are not implemented (webhooks only). See [docs/implementation-plan.md](docs/implementation-plan.md).

## Stack

- SDK: `@debugany/sdk` TypeScript client (non-blocking capture with retries)
- Web: Next.js, React, TypeScript
- API: NestJS, TypeScript, REST
- Database: PostgreSQL, Prisma
- Background jobs: Redis and BullMQ
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

The seed prints the demo user's password and the project's ingestion key once — save them immediately. Register additional accounts at http://localhost:3000/register.

Useful checks:

```bash
npm test          # unit tests; integration tests run when Postgres is reachable
npm run typecheck # strict typecheck of API and dashboard
```

Run the API in one terminal (add `DEBUGANY_INGESTION_MODE_QUEUE=true` to apps/api/.env to enqueue events):

```bash
npm run dev:api
```

Run the background worker in another terminal (processes queued events and webhook deliveries):

```bash
npm run dev:worker
```

Webhook delivery requires `DEBUGANY_ENCRYPTION_KEY` in apps/api/.env (generate with `openssl rand -base64 32`).

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
- [x] User authentication, project management, and per-project key rotation/revocation
- [ ] Process events asynchronously
- [x] Issue resolution from the dashboard
- [x] TypeScript SDK for capturing exceptions from applications
- [ ] Add alert rules and notifications
- [ ] Add dashboard-user authentication, security checks, and deployment

## Security

This is an early development scaffold, not a production-ready monitoring service. Do not send real customer data or secrets. Validate deployment settings and security controls before exposing the API publicly.

## License

License decision pending.
