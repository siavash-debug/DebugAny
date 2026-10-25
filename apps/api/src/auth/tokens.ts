import { createHash, randomBytes } from "node:crypto";

/** Opaque session token; only its SHA-256 hash is stored. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Ingestion key: `dbg_live_` + 48 hex chars (192 bits of entropy). */
export function generateIngestionKey(): string {
  return `dbg_live_${randomBytes(24).toString("hex")}`;
}

/** Displayable prefix, e.g. "dbg_live_ab12cd" — never the full secret. */
export function keyPrefix(key: string): string {
  return key.slice(0, 13);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export const SESSION_TTL_MS = 30 * 24 * 3_600_000;
