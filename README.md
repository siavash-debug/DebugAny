# Debugany

**Every bug. One place.**

Debugany is an application observability platform for developers: error tracking, service health, performance insights, and actionable debugging workflows.

> Status: early-stage project. This repository currently contains the initial project scaffold and architecture notes; production monitoring features are not implemented yet.

## Product vision

Debugany helps developers answer three questions quickly:

- **What broke?** Capture and group application errors with useful context.
- **How bad is it?** Track error trends and service health over time.
- **Where should I look?** Inspect events, stack traces, releases, and alerts in one place.

## Planned stack

- **Web:** Next.js, React, TypeScript
- **API:** NestJS, TypeScript, REST
- **Data:** PostgreSQL, Prisma
- **Background jobs:** Redis and BullMQ
- **Quality:** automated tests, ESLint, type checking
- **Delivery:** Docker Compose and GitHub Actions

The initial architecture is a modular monolith with a separate web app and asynchronous worker. We will only introduce more infrastructure when there is a clear technical need.

## Repository layout

```text
apps/
  api/          # NestJS ingestion and product API
  web/          # Next.js dashboard
  worker/       # Background event processing
packages/
  shared/       # Shared types and contracts
infra/          # Local development and deployment assets
docs/           # Architecture and product decisions
.github/
  workflows/    # CI automation
```

## MVP roadmap

1. Define event contracts, data model, and architecture.
2. Add project setup and API-key-based event ingestion.
3. Process events asynchronously and group similar errors.
4. Build the dashboard for issues, trends, and project filters.
5. Add issue resolution, alert rules, and email notifications.
6. Add tests, security checks, deployment, and a working demo.

## Local development

The project is being scaffolded. Setup instructions will be added as the application services become runnable. Do not put production secrets or real user data in this repository.

## Engineering principles

- Tenant isolation and least-privilege access.
- Validate and limit all incoming event payloads.
- Redact secrets and sensitive values before persistence.
- Make background processing retry-safe and observable.
- Measure performance in reproducible tests; do not publish unverified benchmarks.
- Document trade-offs and keep the first release intentionally small.

## License

License decision pending.
