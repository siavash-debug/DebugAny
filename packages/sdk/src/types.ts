/** Options for constructing a Debugany client. */
export interface DebuganyOptions {
  /** Project ingestion key (`dbg_live_…`). Never log or embed it in client-side code. */
  key: string;
  /** Debugany ingestion base URL, e.g. http://localhost:4000. */
  endpoint?: string;
  /** Defaults to "production". */
  environment?: string;
  /** Release identifier attached to every event. */
  release?: string;
  /** Flush interval in milliseconds. Default 5000. */
  flushIntervalMs?: number;
  /** Queue size that triggers an immediate flush. Default 10. */
  maxQueueSize?: number;
  /** Per-request timeout in milliseconds. Default 5000. */
  requestTimeoutMs?: number;
  /** Total delivery attempts per event. Default 3. */
  deliveryAttempts?: number;
  /** Called for delivery failures (after retries) — use for your own logging. */
  onError?: (error: Error) => void;
  /** Verbose internal logging. Default false. */
  debug?: boolean;
}

/** Optional context for a single captured event. */
export interface CaptureContext {
  metadata?: Record<string, unknown>;
  environment?: string;
  release?: string;
}

/** Payload shape accepted by POST /v1/events. */
export interface IngestionPayload {
  message: string;
  errorType?: string;
  stackTrace?: string;
  environment: string;
  release?: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
}
