import { afterEach, describe, expect, it, vi } from "vitest";
import { Debugany } from "../src/client";
import type { IngestionPayload } from "../src/types";

type FetchCall = { input: string | URL; init: RequestInit };

function installFetchMock(responder: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    const call = { input, init };
    calls.push(call);
    return responder(call);
  });
  return calls;
}

function payloadOf(calls: FetchCall[]): IngestionPayload[] {
  return calls.map((call) => JSON.parse(String(call.init.body)) as IngestionPayload);
}

function makeClient(overrides: Record<string, unknown> = {}) {
  return new Debugany({ key: "dbg_live_test", endpoint: "http://api.test", flushIntervalMs: 60000, ...overrides });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Debugany client", () => {
  it("queues captureException and delivers on flush", async () => {
    const calls = installFetchMock(() => new Response(null, { status: 202 }));
    const client = makeClient();
    client.captureException(new TypeError("boom"), { metadata: { userId: 7 } });
    expect(calls).toHaveLength(0);

    await client.flush();
    expect(calls).toHaveLength(1);
    const payload = payloadOf(calls)[0];
    expect(payload.message).toBe("boom");
    expect(payload.errorType).toBe("TypeError");
    expect(payload.stackTrace).toContain("boom");
    expect(payload.environment).toBe("production");
    expect(payload.metadata).toEqual({ userId: 7 });
    expect(calls[0].init.headers).toMatchObject({ "x-debugany-key": "dbg_live_test" });
    await client.close();
  });

  it("flushes automatically when the queue reaches maxQueueSize", async () => {
    const calls = installFetchMock(() => new Response(null, { status: 202 }));
    const client = makeClient({ maxQueueSize: 2 });
    client.captureMessage("a");
    client.captureMessage("b");
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    await client.close();
  });

  it("retries on 5xx and succeeds on a later attempt", async () => {
    let attempt = 0;
    const calls = installFetchMock(() => {
      attempt += 1;
      return attempt < 3 ? new Response(null, { status: 503 }) : new Response(null, { status: 202 });
    });
    const client = makeClient();
    client.captureMessage("flaky");
    await client.flush();
    expect(attempt).toBe(3);
    await client.close();
  });

  it("drops events rejected with 4xx without retrying", async () => {
    const calls = installFetchMock(() => new Response(null, { status: 401 }));
    const onError = vi.fn();
    const client = makeClient({ onError });
    client.captureMessage("bad key");
    await client.flush();
    expect(calls).toHaveLength(1);
    expect(onError).toHaveBeenCalledOnce();
    await client.close();
  });

  it("never throws to the caller even when delivery keeps failing", async () => {
    installFetchMock(() => { throw new Error("network down"); });
    const client = makeClient({ deliveryAttempts: 1 });
    client.captureMessage("hello");
    await expect(client.flush()).resolves.toBeUndefined();
    await client.close();
  });

  it("uses the per-request timeout signal", async () => {
    const calls = installFetchMock(() => new Response(null, { status: 202 }));
    const client = makeClient({ requestTimeoutMs: 1234 });
    client.captureMessage("timed");
    await client.flush();
    const signal = calls[0].init.signal as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    await client.close();
  });
});
