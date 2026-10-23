# Debugany — Initial Architecture

## Goals

- Accept error events from instrumented applications.
- Validate and authenticate ingestion requests.
- Process events asynchronously.
- Group similar errors into issues.
- Expose project-scoped issue and trend data to the dashboard.

## Proposed event flow

1. An application or SDK sends an event to the ingestion API.
2. The API validates the payload, checks the project ingestion key, applies rate limits, and enqueues the event.
3. A worker normalizes the event, redacts configured sensitive fields, computes a grouping fingerprint, and persists the event and issue.
4. The web dashboard queries project-scoped issue and trend endpoints.
5. Alert evaluation runs asynchronously and sends notifications when configured thresholds are crossed.

## Initial deployment shape

- Next.js web application
- NestJS API
- Background worker process
- PostgreSQL as the source of truth
- Redis/BullMQ for asynchronous jobs

Start with a modular monolith and clear module boundaries. Split services only when measured scale or operational requirements justify the added complexity.

## Security requirements

- Enforce tenant/project authorization on every dashboard query.
- Keep ingestion keys separate from user session credentials.
- Never commit secrets.
- Validate payload size and shape before enqueueing.
- Redact passwords, access tokens, and other sensitive values.
- Define retention and deletion behavior before collecting real customer data.

## Open decisions

- Authentication provider and session strategy
- Event retention defaults
- Error grouping fingerprint rules
- Email provider for alerts
- Deployment target and cost constraints
