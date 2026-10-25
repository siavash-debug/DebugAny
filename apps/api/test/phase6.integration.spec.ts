import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuditService } from "../src/audit/audit.service";
import { ProjectsService } from "../src/projects/projects.service";
import { IngestionCoreService } from "../src/events/ingestion-core.service";
import { AlertsService } from "../src/alerts/alerts.service";
import { WebhooksService } from "../src/webhooks/webhooks.service";
import { WebhookDeliveryService } from "../src/webhooks/delivery.service";
import { assertPublicWebhookHost } from "../src/webhooks/ssrf";
import { createUser, createProjectOwnedBy, type TestUser } from "./helpers";

// Phase 6 integration: idempotent ingestion, alert evaluation with cooldowns
// and dedupe, and signed webhook delivery against a real local receiver.
// Webhook signing requires DEBUGANY_ENCRYPTION_KEY; the delivery queue needs
// Redis (REDIS_URL). Tests skip when DATABASE_URL is absent.
const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

process.env.DEBUGANY_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

function httpBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

describeIntegration("phase 6: alerts, webhooks, idempotency (integration)", () => {
  let prisma: PrismaService;
  let projects: ProjectsService;
  let core: IngestionCoreService;
  let alerts: AlertsService;
  let webhooks: WebhooksService;
  let delivery: WebhookDeliveryService;
  let alice: TestUser;
  let bob: TestUser;
  let project: { id: string; name: string; slug: string };
  let deliveriesQueue: Queue;
  let server: Server;
  let serverUrl: string;
  const secrets = new Map<string, string>();
  const receiver: { requests: Array<{ headers: Record<string, string>; body: string }> } = { requests: [] };
  let receiverMode: "ok" | "fail" | "flaky" = "ok";

  beforeAll(async () => {
    prisma = new PrismaService();
    const audit = new AuditService(prisma);
    projects = new ProjectsService(prisma, audit);
    core = new IngestionCoreService(prisma);
    deliveriesQueue = new Queue("deliveries", { connection: { url: redisUrl } });
    alerts = new AlertsService(prisma, projects, deliveriesQueue);
    // The local HTTP receiver is on 127.0.0.1 with an ephemeral port — both
    // forbidden in production. SSRF enforcement itself is covered by the
    // dedicated tests below using the real checker.
    class TestWebhooks extends WebhooksService {
      override async checkUrl(): Promise<void> {
        return;
      }
    }
    webhooks = new TestWebhooks(prisma, projects, audit);
    delivery = new WebhookDeliveryService(prisma, deliveriesQueue, {
      urlCheck: async () => undefined
    });

    alice = await createUser(prisma, "p6-alice");
    bob = await createUser(prisma, "p6-bob");
    project = await projects.create(alice.user, {
      name: "Phase Six",
      slug: `p6-${Math.random().toString(36).slice(2, 10)}`
    });

    server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const body = await httpBody(req);
      const prior = receiver.requests.filter((r) => r.body === body).length;
      receiver.requests.push({ headers: req.headers as Record<string, string>, body });
      if (receiverMode === "fail") {
        res.writeHead(500).end("nope");
      } else if (receiverMode === "flaky" && prior < 2) {
        res.writeHead(500).end("flaky");
      } else {
        res.writeHead(200).end("ok");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    serverUrl = `http://127.0.0.1:${port}/hook`;
  });

  afterAll(async () => {
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: { endsWith: "@test.debugany.local" } } }).catch(() => undefined);
    await deliveriesQueue.close().catch(() => undefined);
    await prisma.$disconnect();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function ingest(message: string, errorType?: string) {
    return core.processEvent(project, { message, errorType, occurredAt: new Date().toISOString() }, `p6-${randomUUID()}`);
  }

  it("is idempotent per jobId: replaying a processed job creates nothing new", async () => {
    const jobId = `idem-${randomUUID()}`;
    // BullMQ retries replay the identical job payload, including occurredAt.
    const occurredAt = new Date().toISOString();
    const first = await core.processEvent(project, { message: "idempotent event", occurredAt }, jobId);
    const second = await core.processEvent(project, { message: "idempotent event", occurredAt }, jobId);
    expect(second.duplicate).toBe(true);
    expect(second.event.id).toBe(first.event.id);
    const issue = await prisma.issue.findUniqueOrThrow({ where: { id: first.issue.id } });
    expect(issue.count).toBe(1);
  });

  it("rejects cross-project alert and webhook management (IDOR)", async () => {
    await expect(alerts.list(project.id, bob.user.id)).rejects.toMatchObject({ status: 404 });
    await expect(
      alerts.create(project.id, bob.user.id, { name: "Sneaky", type: "NEW_ISSUE", config: {} })
    ).rejects.toMatchObject({ status: 404 });
    await expect(webhooks.list(project.id, bob.user.id)).rejects.toMatchObject({ status: 404 });
    await expect(
      webhooks.create(project.id, bob.user.id, { url: "https://hooks.example.com/x" })
    ).rejects.toMatchObject({ status: 404 });
    await expect(webhooks.listDeliveries(project.id, bob.user.id, "whatever", 20)).rejects.toMatchObject({ status: 404 });
  });

  it("creates rules with validated config and rejects invalid config", async () => {
    const rule = await alerts.create(project.id, alice.user.id, {
      name: "New payment issues",
      type: "NEW_ISSUE_MATCHING",
      config: { titleContains: "payment" }
    });
    expect(rule.enabled).toBe(true);
    await expect(
      alerts.create(project.id, alice.user.id, { name: "Bad", type: "ISSUE_THRESHOLD", config: { threshold: 1 } })
    ).rejects.toMatchObject({ status: 400 });
    const updated = await alerts.update(project.id, alice.user.id, rule.id, { enabled: false });
    expect(updated.enabled).toBe(false);
    await alerts.update(project.id, alice.user.id, rule.id, { enabled: true });
  });

  it("rejects webhook destinations on private, loopback, and metadata addresses", async () => {
    // Real SSRF checker (not the loopback-permissive test subclass).
    const strictWebhooks = new WebhooksService(prisma, projects, new AuditService(prisma));
    for (const url of [
      "http://127.0.0.1:8080/hook",
      "http://10.0.0.5/hook",
      "http://169.254.169.254/latest/meta-data",
      "http://192.168.1.10/hook",
      "https://localhost/hook",
      "ftp://hooks.example.com/x"
    ]) {
      await expect(strictWebhooks.create(project.id, alice.user.id, { url })).rejects.toMatchObject({ status: 400 });
    }
    await expect(assertPublicWebhookHost("http://[::1]/hook")).rejects.toThrow();
  });

  it("stores the webhook secret encrypted and returns it exactly once", async () => {
    const created = await webhooks.create(project.id, alice.user.id, { url: serverUrl, name: "local receiver" });
    expect(created.signingSecret).toMatch(/^[0-9a-f]{64}$/);
    secrets.set(created.id, created.signingSecret);
    const stored = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.secretEnc).not.toBe(created.signingSecret);
    expect(stored.secretEnc.startsWith("v1:")).toBe(true);
    const listing = await webhooks.list(project.id, alice.user.id);
    expect(JSON.stringify(listing)).not.toContain(created.signingSecret);
  });

  it("delivers signed webhooks with cooldown suppression and dedupe", async () => {
    const hook = await webhooks.create(project.id, alice.user.id, { url: serverUrl });
    secrets.set(hook.id, hook.signingSecret);
    const rule = await alerts.create(project.id, alice.user.id, {
      name: "Any new issue",
      type: "NEW_ISSUE",
      config: {},
      cooldownMinutes: 60,
      webhookId: hook.id
    });

    receiver.requests.length = 0;
    const first = await ingest("brand new failure");
    await alerts.evaluateForEvent(project, {
      id: first.issue.id, fingerprint: first.issue.fingerprint, title: "brand new failure", count: 1
    }, true, new Date(first.event.occurredAt));
    expect(receiver.requests).toHaveLength(0); // evaluation only queues; sender runs separately

    const row = await prisma.webhookDelivery.findFirstOrThrow({ where: { alertRuleId: rule.id } });
    expect(row.dedupeKey).toBe(`${rule.id}:${first.issue.id}:1`);

    await delivery.deliverOnce(row.dedupeKey);
    expect(receiver.requests).toHaveLength(1);
    const delivered = await prisma.webhookDelivery.findUniqueOrThrow({ where: { dedupeKey: row.dedupeKey } });
    expect(delivered.status).toBe("DELIVERED");
    expect(delivered.attempts).toBe(1);

    const signature = receiver.requests[0].headers["x-debugany-signature"] as string;
    expect(signature).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(delivery.verifySignature(hook.signingSecret, receiver.requests[0].body, signature)).toBe(true);

    // replaying delivery of an already-delivered row is a no-op
    await delivery.deliverOnce(row.dedupeKey);
    expect(receiver.requests).toHaveLength(1);

    // second new issue within the cooldown window: no re-trigger, no new delivery
    const second = await ingest("another new failure");
    await alerts.evaluateForEvent(project, {
      id: second.issue.id, fingerprint: second.issue.fingerprint, title: "another new failure", count: 1
    }, true, new Date(second.event.occurredAt));
    expect(receiver.requests).toHaveLength(1);
    const deliveryCount = await prisma.webhookDelivery.count({ where: { alertRuleId: rule.id } });
    expect(deliveryCount).toBe(1);

    await alerts.delete(project.id, alice.user.id, rule.id);
    await webhooks.delete(project.id, alice.user.id, hook.id);
  });

  it("retries transient failures and records exhausted attempts", async () => {
    const hook = await webhooks.create(project.id, alice.user.id, { url: serverUrl });

    receiver.requests.length = 0;
    receiverMode = "flaky";
    const row = await prisma.webhookDelivery.create({
      data: {
        endpointId: hook.id,
        projectId: project.id,
        dedupeKey: `retry-${randomUUID()}`,
        payload: { type: "alert.triggered" } as object
      }
    });
    await delivery.deliverOnce(row.dedupeKey, { attempts: 3, backoffMs: [10, 10] });
    const after = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("DELIVERED");
    expect(after.attempts).toBe(3);
    expect(receiver.requests).toHaveLength(3);
    receiverMode = "ok";

    receiver.requests.length = 0;
    receiverMode = "fail";
    const failing = await prisma.webhookDelivery.create({
      data: {
        endpointId: hook.id,
        projectId: project.id,
        dedupeKey: `fail-${randomUUID()}`,
        payload: { type: "alert.triggered" } as object
      }
    });
    await delivery.deliverOnce(failing.dedupeKey, { attempts: 2, backoffMs: [10, 10] });
    const failed = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: failing.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.responseStatus).toBe(500);
    expect(failed.error).toContain("500");
    expect(receiver.requests).toHaveLength(2);
    receiverMode = "ok";
    await webhooks.delete(project.id, alice.user.id, hook.id);
  });

  it("evaluates ISSUE_THRESHOLD at the exact boundary", async () => {
    const rule = await alerts.create(project.id, alice.user.id, {
      name: "Loud issue",
      type: "ISSUE_THRESHOLD",
      config: { threshold: 3 },
      cooldownMinutes: 60
    });

    const loud = await ingest("loud failure", "LoudError");
    await core.processEvent(project, { message: "loud failure", errorType: "LoudError", occurredAt: new Date().toISOString() }, `p6-${randomUUID()}`);
    const issue = await prisma.issue.findUniqueOrThrow({ where: { id: loud.issue.id } });
    expect(issue.count).toBe(2);

    await alerts.evaluateForEvent(project, { id: issue.id, fingerprint: issue.fingerprint, title: issue.title, count: 2 }, false, new Date());
    expect((await prisma.alertRule.findUniqueOrThrow({ where: { id: rule.id } })).lastTriggeredAt).toBeNull();

    await alerts.evaluateForEvent(project, { id: issue.id, fingerprint: issue.fingerprint, title: issue.title, count: 3 }, false, new Date());
    expect((await prisma.alertRule.findUniqueOrThrow({ where: { id: rule.id } })).lastTriggeredAt).not.toBeNull();

    await alerts.delete(project.id, alice.user.id, rule.id);
  });
});
