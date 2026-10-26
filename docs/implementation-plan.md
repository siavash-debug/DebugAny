# Debugany Implementation Plan

> Last verified: 2026-10-24 against commit `e437921`. Every claim below was checked by
> running the actual commands, not inferred from documentation.

## Current architecture

```
apps/web      Next.js 15 + React 19 dashboard (single server-rendered page)
apps/api      NestJS 10 REST API (health, event ingestion, issue listing)
apps/worker   Placeholder README only (BullMQ worker planned)
packages/     Placeholder README only (shared contracts planned)
infra         docker-compose.yml: PostgreSQL 16 + Redis 7
CI            .github/workflows/ci.yml: install → prisma generate → typecheck → builds
```

Data model (`apps/api/prisma/schema.prisma`):
- `Project`: id, name, slug, `apiKeyHash` (SHA-256 at rest), timestamps.
- `ErrorEvent`: message, errorType, stackTrace, environment, release, fingerprint,
  metadata (JSON), occurredAt; three indexes for the current query patterns.
- There is **no `Issue` table**; "issues" are computed on read by grouping the 500
  most recent events in memory.

## Verified working (as of the audit)

- `npm install` completes; `npm run db:generate`, `npm run typecheck`,
  `npm run build:api`, `npm run build:web` all succeed.
- CI on `main` is green (run `40024907835`).
- Ingestion auth uses SHA-256 key hashing at rest with a timing-safe comparison.
- The `POST /v1/events` payload is validated (class-validator, whitelist +
  forbidNonWhitelisted) with per-field length limits.
- The dashboard labels sample/fallback data explicitly and surfaces the reason the
  API is unreachable.

## Known bugs and limitations (verified)

1. **No versioned migrations.** `prisma/migrations/` does not exist. `npm run
   db:migrate` (`prisma migrate dev`) prompts interactively and cannot reproduce the
   schema from a clean checkout. CI never touches a database.
2. **The dashboard is statically prerendered.** `next build` reports `/` as
   `Static`. The API fetch uses `cache: "no-store"` but the page never opted into
   dynamic rendering, so a production build freezes whatever data existed at build
   time (typically the sample fallback) and serves it forever. Needs
   `export const dynamic = "force-dynamic"` (or equivalent).
3. **No tests at all.** No test runner, no unit or integration tests; CI cannot
   catch regressions in grouping logic or auth.
4. **In-memory issue grouping is wrong at scale and subtly misleading:** counts
   reflect only the most recent 500 events, there is no first-seen/last-seen across
   full history, and every issue row is hard-coded to status "Unresolved".
5. **No lockfile in git.** CI explicitly avoids npm cache "without lockfile";
   builds are not reproducible.
6. **Fabricated metrics in the dashboard:** service health percentages and
   latencies, affected users, response-time deltas, and 48 chart bars are all
   hard-coded sample values (labeled as illustrative, but several unlabeled places
   remain — e.g. sidebar project list is hard-coded, "Last 24 hours" selector and
   all filter buttons are decorative).
7. **Decorative controls:** workspace switcher, add-project, search, filters,
   "View all issues", row "···" buttons do nothing.
8. **No logging or error filter.** The API uses `console.log` only; unhandled
   exceptions return default Nest error bodies with no structured logging.
9. **No body-size limits** on ingestion; `metadata` is accepted as arbitrary JSON
   with no size cap or sensitive-key redaction.
10. **No project management:** projects only exist via the seed script; no
    dashboard user auth at all.
11. **No worker/queue** despite Redis being provisioned in docker-compose.
12. `docker-compose.yml` has no top-level `name:`; both services expose ports
    unconditionally (fine locally).

## Prioritized phases and acceptance criteria

### Phase 1 — Stabilize the foundation ✅ target: working local dev + honest CI
- Commit `package-lock.json`; CI gains npm cache.
- Add `prisma/migrations/` (init from current schema) and verify against a clean
  Postgres instance.
- Structured logging (JSON to stdout), a global `HttpExceptionFilter`/exception
  filter, and correlation IDs.
- `/v1/health` gains a readiness variant that actually pings Postgres (and Redis
  once used), with accurate degraded states.
- Request body-size limit on ingestion; reject oversized metadata with 413/422.
- Dashboard page becomes dynamic; loading/empty/error states reflect reality.
- Acceptance: fresh clone + README instructions → API and dashboard run;
  `prisma migrate deploy` succeeds on empty Postgres; CI green with real checks.

### Phase 2 — Real ingestion pipeline ✅ (2026-10-24)
- `Issue` table persisted transactionally on ingest (upsert by
  `(projectId, fingerprint)`): firstSeen, lastSeen, count, status, title, errorType.
- Fingerprinting extracted into a pure, unit-tested function.
- List endpoints with pagination (`limit`/`cursor` or offset), status/environment/
  search filters, time-range queries; bounded `take` (max 100).
- Metadata sanitized: key allowlist/redaction of sensitive-looking keys, size cap.
- No key/payload logging; secrets never enter logs.
- Acceptance: integration tests against Postgres cover ingest → grouping → list;
  malformed payloads → 400/422; unknown key → 401 without log leakage.

### Phase 3 — Issue investigation experience ✅ (2026-10-24)
- Issue detail endpoint: grouped event history (paginated), stack traces,
  release/environment, metadata.
- Status transitions: resolve, reopen, ignore; audit via `updatedAt`.
- Dashboard: issues page + issue detail page wired to real API; no decorative
  buttons on these pages.
- Acceptance: end-to-end flow from curl ingest → visible issue → detail page with
  real stack trace → resolve action persists.

### Phase 4 — Real dashboard metrics ✅ (2026-10-24)
- Time-series endpoint (event counts bucketed by hour/day from real events).
- Dashboard cards: total events, new/unresolved issue counts — all real.
- Remove fabricated service health/latency/affected users; show "Not available"
  states backed by a documented reason until health checks exist.
- Acceptance: no number on the dashboard without a real data source or explicit
  "unavailable" label.

### Phase 5 — Projects and authentication ✅ (2026-10-25)
- Dashboard user auth (email+password with Argon2/bcrypt, httpOnly session
  cookies), project CRUD scoped to users, per-project ingestion keys with
  generate/revoke/rotate and hash-only storage.
- Server-side authorization on every protected route; audit log table for
  administrative actions.
- Acceptance: two users cannot see each other's projects; revoked keys fail
  ingestion immediately.

### Phase 5 — Projects and authentication ✅ (2026-10-25) — delivered
- User auth: register/login/logout/me with Argon2id (OWASP parameters) and
  opaque session tokens stored as SHA-256 hashes, 30-day expiry; rate limiting
  (10/min/IP) on register/login via @nestjs/throttler; constant-time login
  behavior for unknown accounts.
- Projects: CRUD scoped by ProjectMember (OWNER/MEMBER); non-members always
  get 404 (no existence disclosure); creator becomes OWNER; owner-only
  update/delete/rotate; deletion cascades events/issues but not audit rows.
- Keys: per-project IngestionKey rows (SHA-256 at rest, display prefix,
  lastUsedAt tracking), create (raw shown once) / rotate (atomic) / revoke
  (immediate 401); legacy Project.apiKeyHash backfilled and column dropped.
- Dashboard: login/register, httpOnly session cookie, middleware redirect,
  membership-validated active-project cookie, project switcher + creation,
  settings page with key management and confirmed deletion; ingestion key
  never reaches the browser.
- Tests: 29 API tests including IDOR negatives, role boundaries, key
  lifecycle, audit assertions; verified end-to-end in a browser.
- Remaining risks: single API instance (in-memory throttler), no collaborator
  invitations UI yet, sessions not sliding (fixed 30d), no password reset
  flow (needs email delivery), audit log has no viewer UI.

### Phase 6 — Background processing and alerts ✅ (2026-10-25) — delivered
- Ingestion queue: POST /v1/events accepts inline (default) or enqueues via
  BullMQ (DEBUGANY_INGESTION_MODE_QUEUE=true); Redis outages degrade to
  synchronous persistence (never silently drop). Delivery guarantee:
  at-least-once with per-job idempotency (ProcessedJob marker written
  atomically before aggregates; failed jobs release it for retries) — NOT
  exactly-once.
- Worker process (DEBUGANY_WORKER=true): consumes events + webhook delivery
  queues, graceful shutdown (waits for active jobs), /v1/worker/health
  counters, bounded exponential backoff (5 attempts) with failed jobs kept
  inspectable in BullMQ.
- Alert rules: NEW_ISSUE, NEW_ISSUE_MATCHING (title/fingerprint filter),
  ISSUE_THRESHOLD, ERROR_RATE (window 5–1440 min), per-rule cooldown,
  optional webhook targeting, validated configs; evaluated in the worker on
  real persisted data; evaluation failures never break ingestion.
- Duplicate suppression: per-trigger dedupe key (unique) on deliveries plus
  cooldown timestamps; repeated evaluation cannot double-notify.
- Webhooks: project-scoped endpoints; signing secrets AES-256-GCM encrypted
  at rest (DEBUGANY_ENCRYPTION_KEY) and shown once; payloads signed with
  HMAC-SHA256 + timestamp (replay-verifiable, tolerance check helper);
  bounded 10s timeout, 3 attempts with backoff; per-delivery status tracking
  and history API.
- SSRF: http(s) + ports 80/443 only; blocklist covers loopback, private,
  CGNAT, link-local (cloud metadata), benchmark, multicast, IPv6 ULA/
  link-local/multicast, IPv4-mapped IPv6; DNS resolved per hop (redirects
  followed max 3, each re-validated) with a pinned connect-time lookup to
  defeat DNS rebinding. Creation-time validation requires the host to
  resolve (fail-closed) — documented operational consideration.
- Dashboard: settings gains alert-rule and webhook management with delivery
  history; fixed a server-render cookie-write crash found during E2E.
- Remaining risks/limits: in-memory rate limiting is per-instance (needs
  Redis-backed storage for multi-instance); delivery retries are in-process
  (a worker crash mid-delivery loses that attempt, the row stays PENDING);
  no email channel; webhook targets must resolve DNS at creation; audit log
  has no viewer; no delivery requeue API yet.

### Phase 8 — Reliability hardening (delivery recovery) ✅ (2026-10-25/26)
- Delivery claim marker: `WebhookDelivery.startedAt` (migration
  `20261025103338_delivery_claim_marker`, index `(status, startedAt)`).
  `deliverOnce` claims the row conditionally (only while PENDING and not
  freshly claimed), so two workers can never send the same delivery
  concurrently; claims older than 2× request timeout + 60s are stale.
- Worker recovery: after startup (5s) and every 5 minutes a bounded sweep
  re-enqueues abandoned deliveries (PENDING, unclaimed or stale claim,
  attempts < budget). Worker `/v1/worker/health` now reports queue backlog
  counts; graceful shutdown is bounded to 10s so a stuck job cannot block
  process exit.
- Attempt budgets are cumulative across recovery: a crash-loop cannot produce
  unbounded retries; exhausted budgets become terminal FAILED rows
  ("Attempt budget exhausted") inspectable in the UI, and operator requeue
  (service-level `requeueFailed`) grants a fresh budget. The requeue route is
  not wired to an HTTP endpoint yet.
- Fixed a silently lossy bug: **alert-triggered webhook deliveries were never
  enqueued**. BullMQ rejects custom job ids containing ':' (unless the id has
  exactly 3 segments) and the id was `delivery:<rule>:<issue>:<bucket>`; the
  error was swallowed by the alert-evaluation catch. Integration tests
  asserted only the DB row, so CI stayed green. All delivery job ids now go
  through `deliveryJobId()` (colon-free, deterministic) — alert evaluation,
  recovery sweep, and operator requeue.
- Fixed the phase-6 integration test harness (shared webhook receiver was
  closed by its owning suite before the later suites ran, breaking 6 tests);
  the receiver is now file-scoped.
- Remaining hardening work: Redis-backed rate limiting for multi-instance
  APIs, backup/restore runbook, structured-log redaction audit, failure
  testing (kill worker mid-delivery), stalled-job handling via the BullMQ
  stalled-check configuration, HTTP route for operator requeue, delivery
  history surfacing `startedAt`.

### Phase 6 — (previous notes)
- BullMQ worker consuming ingestion (queue-then-persist with bounded retries and
  dead-letter handling) once synchronous ingestion proves insufficient; alert
  rules on new-issue/frequency thresholds; webhook adapter with SSRF protection.
- Acceptance: retry/backoff tests; failed jobs inspectable; no notifications sent
  without explicit configuration.

### Phase 7 — SDK ✅ (2026-10-24)
- `packages/sdk`: TypeScript client (ingestion key + endpoint, captureException,
  release/environment tags, explicit flush, bounded retries, payload caps,
  never blocks the host app). Example app + docs.
- Acceptance: example app's captured exception appears as an issue in the local
  stack.

## Decisions made during the audit

- **Keep the stack** (NestJS/Next/Prisma/Postgres). No technical justification for
  a rewrite was found.
- **Persist issues at ingest time** (Phase 2) rather than grouping on read: it
  makes counts correct over full history, enables status tracking, and keeps list
  queries indexed and cheap.
- **Synchronous ingestion first**, moving to the queue only when it measurably
  helps; the API must not 202 before persistence (current behavior persists
  before responding, which is correct).
