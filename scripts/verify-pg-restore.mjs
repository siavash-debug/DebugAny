#!/usr/bin/env node
/**
 * Safe restore-verification drill for DebugAny's PostgreSQL deployment.
 *
 * What it does (all against DISPOSABLE objects, never the application database):
 *   1. `pg_dump` (custom format) of the configured application database,
 *      read-only, written to a temporary file outside the repository.
 *   2. Creates a fresh `restore_drill_*` database on the same server.
 *   3. Restores the dump into the drill database with `pg_restore`.
 *   4. Compares table row counts source vs. drill.
 *   5. Drops the drill database and removes the temporary dump.
 *
 * Security: the script reads DATABASE_URL from apps/api/.env or the
 * environment and never prints connection strings, user names or passwords —
 * only database names and row counts.
 *
 * Requirements: Node 18+, Docker with the Postgres container running
 * (container name overridable via DEBUGANY_PG_CONTAINER). Set
 * DEBUGANY_KEEP_DRILL_DB=true to retain the drill database for inspection.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, createWriteStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";

const container = process.env.DEBUGANY_PG_CONTAINER ?? "debugany-postgres";

function fail(message) {
  console.error(`RESTORE DRILL FAILED: ${message}`);
  process.exit(1);
}

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  const envFile = path.resolve("apps/api/.env");
  if (!existsSync(envFile)) {
    fail(`DATABASE_URL is not set and ${envFile} does not exist.`);
  }
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^DATABASE_URL=(.*)$/);
    if (match) return match[1].trim().replace(/^"|"$/g, "");
  }
  fail(`No DATABASE_URL line found in ${envFile}.`);
}

function parseDatabaseName(url) {
  try {
    const database = new URL(url).pathname.replace(/^\//, "");
    return database || null;
  } catch {
    return null;
  }
}

/** Runs a command inside the Postgres container as the configured role. */
function pgExec(args) {
  const result = spawnSync("docker", ["exec", "-u", "postgres", container, ...args], {
    encoding: "buffer",
    timeout: 120_000
  });
  if (result.status !== 0) {
    const stderr = (result.stderr ?? Buffer.alloc(0)).toString().trim();
    fail(`docker exec ${args[0]} failed (exit ${result.status}): ${stderr || "no output"}`);
  }
  return result;
}

function tableCounts(database) {
  const counts = {};
  for (const table of TABLES) {
    const out = pgExec(["psql", "-U", pgRole, "-d", database, "-tAc", `SELECT count(*) FROM "${table}"`]);
    counts[table] = Number(out.stdout.toString().trim());
  }
  return counts;
}

const TABLES = [
  "User",
  "Project",
  "ProjectMember",
  "IngestionKey",
  "Issue",
  "ErrorEvent",
  "AlertRule",
  "WebhookEndpoint",
  "WebhookDelivery"
];

const sourceUrl = loadDatabaseUrl();
const sourceDb = parseDatabaseName(sourceUrl);
if (!sourceDb) fail("Could not parse the application database name from DATABASE_URL.");
let pgRole = "postgres";
try {
  pgRole = new URL(sourceUrl).username || pgRole;
} catch {
  fail("DATABASE_URL is not a valid PostgreSQL connection URL.");
}

const suffix = Date.now().toString(36) + randomUUID().slice(0, 6);
const drillDb = `restore_${sourceDb.slice(0, 30)}_${suffix}`.replace(/[^A-Za-z0-9_]/g, "").slice(0, 55);

const tempDir = path.join(os.tmpdir(), `debugany-restore-${suffix}`);
mkdirSync(tempDir, { recursive: true });
const dumpFile = path.join(tempDir, "debugany-drill.dump");

let drillError = null;
try {
  // 1. Logical dump (custom format) into the temp dir.
  console.log(`[1/4] Logical dump of application database "${sourceDb}" (custom format).`);
  const dumpChild = spawn("docker", ["exec", "-u", "postgres", container, "pg_dump", "-U", pgRole, "-d", sourceDb, "-Fc"], {
    stdio: ["ignore", "pipe", "inherit"]
  });
  await pipeline(dumpChild.stdout, createWriteStream(dumpFile));
  await new Promise((resolve, reject) => {
    dumpChild.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`pg_dump exited with code ${code}`))
    );
    dumpChild.on("error", reject);
  });
  const dumpBytes = statSync(dumpFile).size;
  if (dumpBytes === 0) throw new Error("pg_dump produced an empty file.");
  console.log(`      Dump size: ${dumpBytes} bytes.`);

  // 2. Disposable drill database.
  console.log(`[2/4] Creating disposable database "${drillDb}".`);
  pgExec(["psql", "-U", pgRole, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE "${drillDb}"`]);

  // 3. Restore. The dump is copied into the container because custom-format
  // pg_restore needs real, seekable input.
  console.log(`[3/4] Restoring the dump into "${drillDb}".`);
  const containerDump = `/tmp/${suffix}.dump`;
  const copied = spawnSync("docker", ["cp", dumpFile, `${container}:${containerDump}`]);
  if (copied.status !== 0) {
    throw new Error(`docker cp failed: ${(copied.stderr ?? Buffer.alloc(0)).toString().trim()}`);
  }
  pgExec(["pg_restore", "-U", pgRole, "-d", drillDb, "--no-owner", "--exit-on-error", containerDump]);
  // docker cp creates the file as root; cleanup must therefore also run as
  // root (the sticky bit on /tmp prevents the postgres user from deleting it).
  spawnSync("docker", ["exec", container, "rm", "-f", containerDump], { stdio: "ignore" });

  // 4. Verify: every tracked table must have identical row counts.
  console.log("[4/4] Verifying: comparing row counts (source vs. restore).");
  const sourceCounts = tableCounts(sourceDb);
  const drillCounts = tableCounts(drillDb);
  let differences = 0;
  for (const table of TABLES) {
    const matched = Number.isFinite(sourceCounts[table]) && Number.isFinite(drillCounts[table])
      ? sourceCounts[table] === drillCounts[table]
      : false;
    if (!matched) differences += 1;
    console.log(
      `      ${matched ? "ok  " : "DIFF"} ${table}: source=${sourceCounts[table]} restored=${drillCounts[table]}`
    );
  }
  if (differences > 0) {
    const mismatch = new Error(
      `Found ${differences} table difference(s). Keeping drill database for inspection: ${drillDb}`
    );
    mismatch.verificationMismatch = true;
    throw mismatch;
  }
} catch (error) {
  drillError = error;
  if (!error?.verificationMismatch) {
    // Unexpected failures keep nothing behind: the drill database is dropped
    // in the finally block below (prompting a clean re-run is cheaper than a
    // stale, misleading artifact). Dump mishaps and repeated failures are
    // reported by the message printed after cleanup.
    console.error(`RESTORE DRILL FAILED: ${error?.message ?? error}`);
  }
} finally {
  if (process.env.DEBUGANY_KEEP_DRILL_DB === "true" || drillError?.verificationMismatch) {
    console.log(`      Keeping drill database for inspection: ${drillDb}`);
  } else {
    spawnSync(
      "docker",
      [
        "exec",
        "-u",
        "postgres",
        container,
        "psql",
        "-U",
        pgRole,
        "-d",
        "postgres",
        "-c",
        `DROP DATABASE IF EXISTS "${drillDb}"`
      ],
      { stdio: "ignore" }
    );
  }
  rmSync(tempDir, { recursive: true, force: true });
}

if (drillError) {
  process.exit(1);
}

console.log(`RESTORE DRILL PASSED: backup of "${sourceDb}" restores cleanly and matches ${TABLES.length} tables.`);
