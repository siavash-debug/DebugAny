import type { DebuganyOptions, IngestionPayload } from "./types";

/**
 * Delivery transport with a per-request timeout and bounded retries.
 * 4xx responses are dropped (the payload or key is wrong; retrying will not
 * help) while network errors and 5xx responses are retried with backoff.
 */
export class Transport {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly attempts: number;
  private readonly onError: (error: Error) => void;
  private readonly debug: boolean;

  constructor(options: Pick<DebuganyOptions, "endpoint" | "key"> & {
    requestTimeoutMs: number;
    deliveryAttempts: number;
    onError: (error: Error) => void;
    debug: boolean;
  }) {
    this.url = (options.endpoint ?? "http://localhost:4000").replace(/\/+$/, "") + "/v1/events";
    this.timeoutMs = options.requestTimeoutMs;
    this.attempts = options.deliveryAttempts;
    this.onError = options.onError;
    this.debug = options.debug;
    this.key = options.key;
  }

  private readonly key: string;

  async send(payload: IngestionPayload): Promise<boolean> {
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      try {
        const response = await fetch(this.url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-debugany-key": this.key },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.timeoutMs)
        });
        if (response.ok) {
          return true;
        }
        if (response.status >= 400 && response.status < 500) {
          this.onError(new Error(`Debugany rejected the event with HTTP ${response.status}; dropping it.`));
          return false;
        }
        lastError = new Error(`Debugany returned HTTP ${response.status}.`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
      if (attempt < this.attempts) {
        await delay(250 * 2 ** (attempt - 1));
      }
    }
    if (this.debug) {
      console.error("[debugany] delivery failed:", lastError?.message);
    }
    this.onError(lastError ?? new Error("Debugany delivery failed."));
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
