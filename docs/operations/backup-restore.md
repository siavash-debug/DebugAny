# PostgreSQL backup and restore — DebugAny

Status: **restore verified**. The drill documented in section 6 was executed
against the local Docker deployment (dump of the configured application
database restored into a disposable database; all tracked tables matched).

## 1. Scope and assumptions

- The repository ships a **single-node Docker Compose** deployment
  (PostgreSQL 16 in the `debugany-postgres` container, data volume
  `debugany_postgres_data`). The runbook treats that as the reference setup;
  hosted providers (RDS/Cloud SQL/Neon/Supabase) replace section 3 with
  provider-managed backups — see section 5.
- Environment variable names referenced (values are never stored in this
  repository): `DATABASE_URL` in `apps/api/.env` (or the compose-native
  `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`), `DEBUGANY_PG_CONTAINER`,
  `DEBUGANY_KEEP_DRILL_DB`.

## 2. Logical backups (recommended, what the drill validates)

A logical backup is a `pg_dump` of schema + data. It is version-portable
(restore into a newer Postgres works), excludes bloated operational state, and
is small (the 8-table local drill dump was ~74 KB). It does **not** capture
cluster state such as roles, `pg_hba.conf`, extensions config, or Redis data.

Periodic logical dump (custom format, run from the host while Postgres runs):

```bash
docker exec -u postgres debugany-postgres \
  pg_dump -U debugany -d debugany -Fc > debugany_$(date +%Y%m%dT%H%M%S).dump
```

Continuous variant (cron/systemd timer/CI schedule): dump to disk, push to
object storage. Keep dumps out of the git repository and out of the web root.

## 3. Volume snapshots and what they are NOT for

- **Snapshot of `debugany_postgres_data` while Postgres runs** can be torn
  (data files + WAL must match). Use filesystem snapshots only when the
  filesystem provides crash-consistent point-in-time behavior together with
  WAL archiving, or when the container is stopped first.
- Volume snapshots are a recovery convenience for hardware loss, not a restore
  guarantee for logical corruption or accidental deletion — a bad write is
  copied forward faithfully.

## 4. Encryption, retention, and access control

- **Encrypt dumps before leaving the machine** (client-side encryption with
  `age`/`gpg --symmetric`); the repository intentionally contains only variable
  *names*, never credentials. Unencrypted dump files are the most common
  production leak.
- **Retention:** e.g. 7 daily + 4 weekly + 6 monthly dumps; prune after a
  backup is verifiably restorable; store at least one copy off-machine
  (object storage, different account).
- **Access control:** only one service principal should have write access to
  the backup bucket; restores are operator actions and are audited; dump files
  must be deleted from temporary directories after use (the drill script does
  this automatically).

## 5. Provider-managed backups (when moving off Compose)

When the database is managed (RDS/Cloud SQL/Neon/Supabase/etc.):
enable automated backups + point-in-time recovery, keep the retention window
documented in the deployment IaC, and still run the **restore drill**
(section 6) against a disposable database — provider backups are only proven
usable when a restore is exercised.

## 6. Restore drill (automated, safe by construction)

`npm run verify:restore` runs `scripts/verify-pg-restore.mjs`:

1. Dumps the configured application database (`pg_dump -Fc`, read-only).
2. Creates a disposable `restore_<appdb>_<suffix>` database on the same
   server.
3. Restores the dump into it (`pg_restore --no-owner --exit-on-error`).
4. Compares row counts of `User`, `Project`, `ProjectMember`,
   `IngestionKey`, `Issue`, `ErrorEvent`, `AlertRule`, `WebhookEndpoint`,
   `WebhookDelivery` between source and restore.
5. Drops the drill database and deletes the temporary dump — except when
   verification mismatches or `DEBUGANY_KEEP_DRILL_DB=true`.

The script never touches the application database destructively: its only
write target is the disposable drill database. Requirements: Node 18+, Docker
with the Postgres container running. Database/container overrides:
`DEBUGANY_PG_CONTAINER=<container name>`.

## 7. Manual restore into a NEW database (never the app DB)

```bash
# 1. Create a disposable database (names may vary per deployment).
docker exec -u postgres debugany-postgres \
  psql -U debugany -d postgres -c 'CREATE DATABASE restored_from_drill'

# 2. Copy the dump into the container and restore.
docker cp debugany.dump debugany-postgres:/tmp/restore.dump
docker exec -u postgres debugany-postgres \
  pg_restore -U debugany -d restored_from_drill --no-owner --exit-on-error /tmp/restore.dump

# 3. Verify, then cut over only after checks pass; drop the old database
#    only when the operator explicitly intends to retire it.
```

Restore drills must target a database whose name starts with `restore_`;
running `pg_restore` directly against the configured application database is
prohibited by this runbook.

## 8. Companion stores and what backup policy they need

- **Redis** (queue, rate limiting, session data where configured): queue data
  is at-least-once transient by design; losing it loses in-flight jobs, not
  accepted issues. Enable AOF for queue durability across restarts (the local
  compose now runs `redis-server --appendonly yes`). Backups are NOT required
  but a fast Redis restart + app restart is part of the recovery runbook.
- **Backups vs. Prisma migrations:** after a restore, run
  `npm run prisma:deploy` in CI only to confirm `_prisma_migrations` state; a
  good backup already contains a consistent `_prisma_migrations` table.

## 9. Drill log

| Date | Commit | Result |
|------|--------|--------|
| 2026-10-26 | feat/phase8-hardening (pre-commit) | PASSED — 9/9 tables matched, drill db dropped |
