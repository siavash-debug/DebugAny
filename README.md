# Debugany

**Every bug. One place.**

Debugany is an application observability platform for developers: error tracking, service health, performance insights, and actionable debugging workflows.

> Status: early-stage project. The first API vertical slice is being implemented; production monitoring features are not complete.

## Product vision

- **What broke?** Capture errors with useful context.
- **How bad is it?** Track error trends and service health over time.
- **Where should I look?** Inspect events, stack traces, releases, and alerts in one place.

## Planned stack

- **Web:** Next.js, React, TypeScript
- **API:** NestJS, TypeScript, REST
- **Data:** PostgreSQL, Prisma
- **Background jobs:** Redis and BullMQ
- **Quality:** automated tests, ESLint, type checking
- **Delivery:** Docker Compose and GitHub Actions

## Repository layout

```text
apps/
  api/          # NestJS API and error ingestion
  web/          # Next.js dashboard (planned)
  worker/       # Background event processing (planned)
packages/
  shared/       # Shared types and contracts (planned)
docs/           # Architecture and product decisions
.github/
  workflows/    # CI automation
```

## Current implementation

- Health endpoint: `GET /v1/health`
- Project-scoped ingestion key, stored as a SHA-256 hash
- Validated error-event payloads: `POST /v1/events`
- PostgreSQL persistence via Prisma
- Docker Compose services for local PostgreSQL and Redis

See [API setup instructions](apps/api/README.md) and [architecture notes](docs/architecture.md).

## MVP roadmap

1. [x] Define the first API vertical slice and event data model.
2. [ ] Add project management and safer key rotation.
3. [ ] Process events asynchronously and group issues.
4. [ ] Build the dashboard for issues, trends, and project filters.
5. [ ] Add issue resolution, alert rules, and notifications.
6. [ ] Add integration tests, security checks, deployment, and a working demo.

## Engineering principles

- Enforce tenant/project boundaries on every dashboard query.
- Validate and limit incoming event payloads.
- Redact secrets and sensitive values before persistence.
- Make background processing retry-safe and observable.
- Measure performance in reproducible tests; do not publish unverified benchmarks.
- Keep real secrets and customer data out of the repository.

## License

License decision pending.
