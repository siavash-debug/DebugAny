import { Logger } from "@nestjs/common";

const logger = new Logger("Config");

function str(name: string, fallback?: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1";
}

/** Parsed, typed environment. Fails fast at boot for invalid values. */
export const env = {
  get redisUrl(): string {
    return str("REDIS_URL", "redis://localhost:6379")!;
  },
  /** When true, the API enqueues events for the worker instead of persisting inline. */
  get ingestionViaQueue(): boolean {
    return bool("DEBUGANY_INGESTION_MODE_QUEUE", false);
  },
  /** When true, this process consumes the events and webhook delivery queues. */
  get workerEnabled(): boolean {
    return bool("DEBUGANY_WORKER", false);
  },
  /**
   * Where auth rate limits are stored: per-process memory (default,
   * single-instance) or Redis (shared across API instances).
   */
  get rateLimitStorage(): "memory" | "redis" {
    const raw = str("DEBUGANY_RATE_LIMIT_STORAGE", "memory")!;
    if (raw !== "memory" && raw !== "redis") {
      throw new Error("DEBUGANY_RATE_LIMIT_STORAGE must be 'memory' or 'redis'.");
    }
    return raw;
  },
  /** Base64-encoded 32-byte AES-256 key used to encrypt webhook secrets at rest. */
  get encryptionKey(): Buffer | undefined {
    const raw = str("DEBUGANY_ENCRYPTION_KEY");
    if (!raw) return undefined;
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) {
      throw new Error("DEBUGANY_ENCRYPTION_KEY must decode to exactly 32 bytes.");
    }
    return key;
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  }
};

export function requireEncryptionKey(): Buffer {
  const key = env.encryptionKey;
  if (!key) {
    throw new Error(
      "DEBUGANY_ENCRYPTION_KEY is required for webhook secrets. Generate one with: openssl rand -base64 32"
    );
  }
  return key;
}

export function warnMissingEncryptionKey(): void {
  if (!process.env.DEBUGANY_ENCRYPTION_KEY) {
    logger.warn("DEBUGANY_ENCRYPTION_KEY is not set; webhook endpoints cannot be created until it is configured.");
  }
}
