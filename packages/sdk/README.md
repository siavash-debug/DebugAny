# @debugany/sdk

Official TypeScript SDK for sending errors to Debugany. Non-blocking by
design: captured events are queued and delivered in the background with
timeouts, bounded retries, and payload-size limits. The SDK only collects
what you explicitly pass — it never scrapes environment variables, request
bodies, or local variables.

## Install

The SDK lives in this monorepo (`packages/sdk`). Add it to your app via an
npm workspace, a path dependency, or by publishing it from CI.

## Getting an ingestion key

Each project has its own keys. In the Debugany dashboard open
**Settings → Ingestion keys** and create one, or use the API:

```bash
curl -X POST http://localhost:4000/v1/projects/PROJECT_ID/keys   -H 'authorization: Bearer YOUR_SESSION_TOKEN'   -H 'content-type: application/json' -d '{"name": "production"}'
```

The raw key (`dbg_live_…`) is returned exactly once; the API stores only its
hash. Rotating a key atomically replaces it (the old key stops working
immediately); revoking does the same without a replacement. Keep keys in
server-side environment variables — never in client-side bundles.

## Quick start

```ts
import { Debugany } from "@debugany/sdk";

const debugany = new Debugany({
  key: process.env.DEBUGANY_INGESTION_KEY!, // dbg_live_… from project setup
  endpoint: "http://localhost:4000",
  environment: "production",
  release: "1.4.2"
});

try {
  processPayment();
} catch (error) {
  debugany.captureException(error, {
    metadata: { orderId: "ord_123" } // opt-in, never auto-collected
  });
}

debugany.captureMessage("Checkout recovered after retry");

// During graceful shutdown:
await debugany.close();
```

## API

- `new Debugany(options)` — options: `key` (required), `endpoint`,
  `environment`, `release`, `flushIntervalMs` (5000), `maxQueueSize` (10),
  `requestTimeoutMs` (5000), `deliveryAttempts` (3), `onError`, `debug`.
- `captureException(error, context?)` — captures any thrown value.
- `captureMessage(message, context?)` — captures a plain message.
- `flush()` — deliver queued events now; resolves when delivery settles.
- `close()` — flush, stop the background timer. Await during shutdown.
- `installGlobalHandlers()` — opt-in: also report `uncaughtException` and
  `unhandledRejection`.

Delivery behavior: one HTTP request per event to `POST /v1/events` with the
ingestion key header. Network errors and 5xx responses are retried with
exponential backoff up to `deliveryAttempts`; 4xx events are dropped and
reported through `onError`. Nothing ever throws into your application.

## Example

See [examples/node/example.ts](examples/node/example.ts) for a runnable
script that captures an exception and a message against a local stack.
