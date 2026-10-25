import { Inject, Injectable, Logger } from "@nestjs/common";
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";
import { createHmac, timingSafeEqual } from "node:crypto";
import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import { Prisma } from "@prisma/client";
import type { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { decryptSecret } from "./crypto";
import { assertPublicWebhookHost, isBlockedAddress, parseWebhookUrl } from "./ssrf";
import { DELIVERIES_QUEUE_TOKEN } from "../queue/queue.module";

const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [500, 2_000];

export interface DeliveryServiceOptions {
  /** Override for tests targeting a local receiver. */
  urlCheck?: (url: string) => Promise<void>;
  fetchImpl?: typeof undiciFetch;
}

export interface DeliverOptions {
  attempts?: number;
  backoffMs?: number[];
}

interface DeliveryJobData {
  deliveryKey: string;
}

/**
 * Sends signed webhook deliveries. Runs on the deliveries queue, so retries
 * and slow receivers never block event ingestion.
 *
 * Signing: `X-Debugany-Signature: t=<unix seconds>,v1=hex(HMAC-SHA256(secret, "<t>.<body>"))`.
 * Receivers recompute the HMAC over the raw body with the timestamp they
 * received and reject replays older than their tolerance.
 *
 * SSRF: every hop (initial URL and each redirect) is resolved and checked
 * against the private-address blocklist; the connect lookup pins the
 * validated address so DNS cannot rotate to a private IP mid-request.
 */
@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);

  private readonly urlCheck: (url: string) => Promise<void>;
  private readonly fetchImpl: typeof undiciFetch;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(DELIVERIES_QUEUE_TOKEN) private readonly deliveriesQueue: Queue<DeliveryJobData>,
    options: DeliveryServiceOptions = {}
  ) {
    this.urlCheck = options.urlCheck ?? (async (url) => void (await assertPublicWebhookHost(url)));
    this.fetchImpl = options.fetchImpl ?? undiciFetch;
  }

  /**
   * Delivers a pending delivery row. Called by the queue worker; safe to call
   * directly in tests. Delivery state (PENDING/DELIVERED/FAILED, attempts,
   * response status) is tracked on the row.
   */
  async deliverOnce(deliveryKey: string, options: DeliverOptions = {}): Promise<void> {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { dedupeKey: deliveryKey },
      include: { endpoint: { select: { id: true, url: true, secretEnc: true, enabled: true } } }
    });
    if (!delivery) return;
    if (delivery.status !== "PENDING") return; // already delivered or final-failed
    if (!delivery.endpoint.enabled) {
      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: "FAILED", error: "Endpoint disabled" }
      });
      return;
    }

    const secret = decryptSecret(delivery.endpoint.secretEnc);
    const body = JSON.stringify(delivery.payload);
    const maxAttempts = options.attempts ?? MAX_ATTEMPTS;
    const backoff = options.backoffMs ?? BACKOFF_MS;

    let lastError: string | undefined;
    let lastStatus: number | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const status = await this.sendSigned(delivery.endpoint.url, body, secret);
        lastStatus = status;
        if (status >= 200 && status < 300) {
          await this.prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: { status: "DELIVERED", attempts: attempt, responseStatus: status, deliveredAt: new Date() }
          });
          return;
        }
        lastError = `Receiver responded with HTTP ${status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, backoff[attempt - 1] ?? backoff[backoff.length - 1]));
      }
    }

    await this.prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "FAILED",
        attempts: maxAttempts,
        responseStatus: lastStatus ?? null,
        error: lastError?.slice(0, 500)
      }
    });
  }

  /** Computes the signature header exactly as a receiver would verify it. */
  public signPayload(secret: string, body: string, timestampSeconds: number): string {
    const mac = createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex");
    return `t=${timestampSeconds},v1=${mac}`;
  }

  /** Constant-time signature verification (mirrors receiver-side logic). */
  public verifySignature(secret: string, body: string, header: string, toleranceSeconds = 300): boolean {
    const match = header.match(/^t=(\d+),v1=([0-9a-f]{64})$/);
    if (!match) return false;
    const timestamp = Number(match[1]);
    if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;
    const expected = createHmac("sha256", secret).update(`${match[1]}.${body}`).digest();
    const received = Buffer.from(match[2], "hex");
    return expected.length === received.length && timingSafeEqual(expected, received);
  }

  private async sendSigned(url: string, body: string, secret: string): Promise<number> {
    const doFetch = this.fetchImpl;
    let current = url;
    const usingDefaultCheck = this.urlCheck === WebhookDeliveryService.defaultUrlCheck;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // Resolve + blocklist-check this hop; the agent pins the validated IPs.
      await this.urlCheck(current);
      const agent = usingDefaultCheck ? this.agentFor(new URL(current).hostname) : undefined;
      const timestamp = Math.floor(Date.now() / 1000);

      const response = await doFetch(current, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-debugany-signature": this.signPayload(secret, body, timestamp),
          "x-debugany-timestamp": String(timestamp)
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...(agent ? { dispatcher: agent as unknown as Dispatcher } : {})
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return response.status;
        current = new URL(location, current).toString();
        await response.body?.cancel().catch(() => undefined);
        continue;
      }
      await response.body?.cancel().catch(() => undefined);
      return response.status;
    }
    throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);
  }

  private agents = new Map<string, Agent>();

  /**
   * Per-hostname agent whose connect lookup resolves all addresses, filters
   * them through the blocklist, and pins the connection to a validated IP —
   * closing the DNS-rebinding window between check and connect.
   */
  private agentFor(hostname: string): Agent {
    let agent = this.agents.get(hostname);
    if (!agent) {
      agent = new Agent({
        connect: {
          lookup: (hostnameOverride, options, callback) => {
            dnsLookup(hostnameOverride, { all: true, verbatim: true }, (error, addresses) => {
              if (error) {
                callback(error, undefined as never);
                return;
              }
              const list = Array.isArray(addresses) ? addresses : [addresses as never];
              const allowed = list
                .map((entry) => (entry as { address: string }).address)
                .filter((address) => isIP(address) !== 0 && !isBlockedAddress(address));
              if (allowed.length === 0) {
                callback(new Error("Host resolves only to forbidden addresses"), undefined as never);
                return;
              }
              const mapped = allowed.map((address) => ({
                address,
                family: isIP(address) as 4 | 6
              }));
              if (options.all) {
                callback(null, mapped as never);
              } else {
                callback(null, mapped[0] as never);
              }
            });
          }
        }
      });
      this.agents.set(hostname, agent);
    }
    return agent;
  }

  /** Queues redelivery of failed deliveries (operator action via API later). */
  async requeueFailed(deliveryId: string, projectId: string): Promise<{ requeued: boolean }> {
    const delivery = await this.prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, projectId, status: "FAILED" },
      select: { dedupeKey: true }
    });
    if (!delivery) {
      throw new Prisma.PrismaClientKnownRequestError("Delivery not found", { code: "P2025", clientVersion: "x" });
    }
    await this.deliveriesQueue.add("deliver", { deliveryKey: delivery.dedupeKey });
    return { requeued: true };
  }

  /** Purges the pinned-agent cache (for tests). */
  public clearAgents(): void {
    this.agents.clear();
  }

  private static defaultUrlCheck(url: string): Promise<void> {
    return assertPublicWebhookHost(url).then(() => undefined);
  }
}
