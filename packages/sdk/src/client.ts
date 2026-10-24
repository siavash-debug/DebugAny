import { Transport } from "./transport";
import type { CaptureContext, DebuganyOptions, IngestionPayload } from "./types";

export type { CaptureContext, DebuganyOptions, IngestionPayload } from "./types";

const DEFAULTS = {
  endpoint: "http://localhost:4000",
  environment: "production",
  flushIntervalMs: 5000,
  maxQueueSize: 10,
  requestTimeoutMs: 5000,
  deliveryAttempts: 3
} as const;

const MAX_STACK_LENGTH = 12_000;
const MAX_MESSAGE_LENGTH = 2_000;

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength) + "…[truncated]";
}

/**
 * Non-blocking error reporter for Debugany.
 *
 * Captured events are queued in memory and delivered in the background, so
 * telemetry never blocks application execution. Call {@link close} during
 * graceful shutdown to flush pending events.
 */
export class Debugany {
  private readonly transport: Transport;
  private readonly environment: string;
  private readonly release?: string;
  private readonly flushIntervalMs: number;
  private readonly maxQueueSize: number;
  private readonly debug: boolean;

  private queue: IngestionPayload[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(options: DebuganyOptions) {
    if (!options.key || typeof options.key !== "string") {
      throw new Error("Debugany requires an ingestion key.");
    }
    this.environment = options.environment ?? DEFAULTS.environment;
    this.release = options.release;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULTS.flushIntervalMs;
    this.maxQueueSize = options.maxQueueSize ?? DEFAULTS.maxQueueSize;
    this.debug = options.debug ?? false;

    this.transport = new Transport({
      key: options.key,
      endpoint: options.endpoint ?? DEFAULTS.endpoint,
      requestTimeoutMs: options.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs,
      deliveryAttempts: options.deliveryAttempts ?? DEFAULTS.deliveryAttempts,
      onError: options.onError ?? (() => undefined),
      debug: this.debug
    });

    this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
    this.timer.unref?.();
  }

  /** Captures an Error (or anything stringifiable) and returns immediately. */
  captureException(error: unknown, context?: CaptureContext): void {
    const message = error instanceof Error ? error.message : String(error);
    this.enqueue({
      message: truncate(message, MAX_MESSAGE_LENGTH),
      errorType: error instanceof Error ? error.name : undefined,
      stackTrace: error instanceof Error && error.stack ? truncate(error.stack, MAX_STACK_LENGTH) : undefined,
      ...this.baseFields(context)
    });
  }

  /** Captures a plain message as an event. */
  captureMessage(message: string, context?: CaptureContext): void {
    this.enqueue({ message: truncate(message, MAX_MESSAGE_LENGTH), ...this.baseFields(context) });
  }

  /** Sends all queued events now. Safe to call repeatedly. */
  flush(): Promise<void> {
    const pending = this.queue;
    this.queue = [];
    this.inFlight = this.inFlight.then(async () => {
      await Promise.all(pending.map((payload) => this.transport.send(payload)));
    });
    return this.inFlight;
  }

  /**
   * Flushes pending events and stops the background timer. Await this during
   * graceful shutdown; subsequent captures are still accepted but only leave
   * the process on the next flush.
   */
  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.flush();
  }

  /** Opt-in hooks so unexpected process failures still reach Debugany. */
  installGlobalHandlers(): void {
    process.on("uncaughtException", (error) => this.captureException(error));
    process.on("unhandledRejection", (reason) => this.captureException(reason));
  }

  private baseFields(context?: CaptureContext) {
    return {
      environment: context?.environment ?? this.environment,
      release: context?.release ?? this.release,
      occurredAt: new Date().toISOString(),
      // Only caller-provided context is collected; the SDK never scrapes
      // environment variables, request bodies, or local variables.
      metadata: context?.metadata
    };
  }

  private enqueue(payload: IngestionPayload): void {
    if (this.closed) {
      if (this.debug) console.warn("[debugany] capture after close(); event queued until next flush");
    }
    this.queue.push(payload);
    if (this.queue.length >= this.maxQueueSize) {
      void this.flush();
    }
  }
}
