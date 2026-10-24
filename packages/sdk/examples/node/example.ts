/**
 * Minimal example: capture an exception from a Node.js script.
 *
 * Run from the repository root:
 *   node --env-file=apps/api/.env --import tsx packages/sdk/examples/node/example.ts
 */
import { Debugany } from "../../src/client";

const debugany = new Debugany({
  key: process.env.DEBUGANY_INGESTION_KEY ?? process.env.DEBUGANY_API_KEY ?? "",
  endpoint: process.env.DEBUGANY_API_URL ?? "http://localhost:4000",
  environment: "development",
  release: "example-1.0.0",
  debug: true
});

function processPayment() {
  throw new Error("Payment provider timed out");
}

try {
  processPayment();
} catch (error) {
  debugany.captureException(error, {
    metadata: { orderId: "ord_123", provider: "stripe" }
  });
}

debugany.captureMessage("Checkout flow recovered after retry", {
  metadata: { attempt: 2 }
});

await debugany.close();
console.log("Events delivered to Debugany — check the dashboard at http://localhost:3000");
