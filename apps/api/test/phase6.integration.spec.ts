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

// Shared receiver + fixtures used by both Phase 6 suites.
const secrets = new Map<string, string>();
const receiver: { requests: Array<{ headers: Record<string, string>; body: string }> } = { requests: [] };
let receiverMode: "ok" | "fail" | "flaky" = "ok";
let serverUrl = "";
let server: Server;

async function startReceiver(): Promise<void> {
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
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      serverUrl = `http://127.0.0.1:${port}/hook`;
      resolve();
    });
  });
}

// The local webhook receiver is shared by both phase 6 integration suites.
// Start it once for the whole file (top-level hook), so suite boundaries do
// not close the server while later suites still deliver webhooks.
beforeAll(() => startReceiver(), 10_000);
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const moduleScopedDescribe = databaseUrl ? describe : describe.skip;
moduleScopedDescribe("phase 6 shared receiver", () => {
  it("starts the local receiver", () => {
    expect(serverUrl).toContain("127.0.0.1");
  });
});

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

  });

  afterAll(async () => {
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: { startsWith: "p6-" } } }).catch(() => undefined);
    await deliveriesQueue.close().catch(() => undefined);
    await prisma.$disconnect();
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

    // Regression: the trigger must actually enqueue the delivery into BullMQ.
    // The old job id contained a colon and BullMQ rejected it silently, so
    // alert-triggered rows stayed PENDING forever in production.
    const queued = await deliveriesQueue.getJobs(["waiting", "active", "prioritized"], 0, 100);
    expect(queued.map((job) => (job.data as { deliveryKey?: string }).deliveryKey)).toContain(row.dedupeKey);

    await delivery.deliverOnce(row.dedupeKey);
    const delivered = await prisma.webhookDelivery.findUniqueOrThrow({ where: { dedupeKey: row.dedupeKey } });
    expect(`${delivered.status}: ${delivered.error ?? "no error"}`).toBe("DELIVERED: no error");
    expect(receiver.requests).toHaveLength(1);
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
    await delivery.deliverOnce(failing.dedupeKey, { backoffMs: [10, 10, 10] });
    const failed = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: failing.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.responseStatus).toBe(500);
    expect(failed.error).toContain("500");
    expect(failed.attempts).toBe(3);
    expect(receiver.requests).toHaveLength(3);
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

describeIntegration("phase 6: delivery recovery (integration)", () => {
  let prisma: PrismaService;
  let projects: ProjectsService;
  let webhooks: WebhooksService;
  let delivery: WebhookDeliveryService;
  let alice: TestUser;
  let bob: TestUser;
  let project: { id: string; name: string; slug: string };
  let otherProject: { id: string; name: string; slug: string };
  let hook: { id: string; signingSecret: string };
  let deliveriesQueue: Queue;

  beforeAll(async () => {
    prisma = new PrismaService();
    const audit = new AuditService(prisma);
    projects = new ProjectsService(prisma, audit);
    deliveriesQueue = new Queue("deliveries", { connection: { url: redisUrl } });
    delivery = new WebhookDeliveryService(prisma, deliveriesQueue, { urlCheck: async () => undefined });
    class TestWebhooks extends WebhooksService {
      override async checkUrl(): Promise<void> {
        return;
      }
    }
    webhooks = new TestWebhooks(prisma, projects, audit, delivery);
    alice = await createUser(prisma, "p6-recover");
    bob = await createUser(prisma, "p6-other");
    project = await projects.create(alice.user, {
      name: "Recovery",
      slug: `p6r-${Math.random().toString(36).slice(2, 10)}`
    });
    otherProject = await projects.create(bob.user, {
      name: "Recovery Other",
      slug: `p6ro-${Math.random().toString(36).slice(2, 10)}`
    });
    hook = await webhooks.create(project.id, alice.user.id, { url: serverUrl });
    secrets.set(hook.id, hook.signingSecret);
  });

  afterAll(async () => {
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.project.delete({ where: { id: otherProject.id } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: { startsWith: "p6-" } } }).catch(() => undefined);
    await deliveriesQueue.close().catch(() => undefined);
    await prisma.$disconnect();
  });

  function makeDelivery(dedupeKey: string, extra: Record<string, unknown> = {}) {
    return prisma.webhookDelivery.create({
      data: {
        endpointId: hook.id,
        projectId: project.id,
        dedupeKey,
        payload: { type: "alert.triggered" } as object,
        ...extra
      }
    });
  }

  it("recovers an abandoned delivery (stale claim) via recoverAbandoned", async () => {
    receiver.requests.length = 0;
    receiverMode = "ok";
    const row = await makeDelivery(`recover-${randomUUID()}`, {
      startedAt: new Date(Date.now() - 10 * 60_000) // stale claim: worker crashed mid-send
    });
    const requeued = await delivery.recoverAbandoned(50);
    expect(requeued).toBeGreaterThanOrEqual(1);

    // The enqueued job exists; simulate the worker by delivering directly.
    const recoveryJobs = await deliveriesQueue.getJobs(["waiting", "active", "prioritized"], 0, 100);
    expect(recoveryJobs.map((job) => (job.data as { deliveryKey?: string }).deliveryKey)).toContain(row.dedupeKey);
    await delivery.deliverOnce(row.dedupeKey);
    const after = await prisma.webhookDelivery.findUniqueOrThrow({ where: { dedupeKey: row.dedupeKey } });
    if (after.status !== "DELIVERED") {
      throw new Error(`recovery delivery failed: ${after.error ?? "?"}`);
    }
    expect(after.status).toBe("DELIVERED");
    expect(receiver.requests).toHaveLength(1);
  });

  it("recovers claims that just crossed the staleness boundary", async () => {
    receiver.requests.length = 0;
    receiverMode = "ok";
    // A worker crashed mid-send ~85s ago: past the staleness cutoff (2 x 10s
    // request timeout + 60s margin), so the sweep must reclaim it.
    const row = await makeDelivery(`boundary-${randomUUID()}`, {
      startedAt: new Date(Date.now() - 85_000)
    });
    await delivery.recoverAbandoned(50);
    const boundaryJobs = await deliveriesQueue.getJobs(["waiting", "active", "prioritized"], 0, 100);
    expect(boundaryJobs.map((job) => (job.data as { deliveryKey?: string }).deliveryKey)).toContain(row.dedupeKey);
    await delivery.deliverOnce(row.dedupeKey);
    expect((await prisma.webhookDelivery.findUniqueOrThrow({ where: { dedupeKey: row.dedupeKey } })).status).toBe("DELIVERED");
  });

  it("does not recover fresh claims or exhausted deliveries", async () => {
    receiver.requests.length = 0;
    receiverMode = "fail";
    const fresh = await makeDelivery(`fresh-${randomUUID()}`, { startedAt: new Date() }); // in-progress
    const exhausted = await makeDelivery(`exhausted-${randomUUID()}`, { attempts: 3, startedAt: new Date(Date.now() - 10 * 60_000) });

    await delivery.recoverAbandoned(50);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect((await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe("PENDING");
    // exhausted budget becomes terminal on the next deliverOnce touch, not via recovery
    await delivery.deliverOnce(exhausted.dedupeKey);
    const terminal = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: exhausted.id } });
    expect(terminal.status).toBe("FAILED");
    expect(terminal.error).toContain("budget");
    expect(receiver.requests).toHaveLength(0);
    receiverMode = "ok";
  });

  it("prevents concurrent delivery of the same row via the claim", async () => {
    receiver.requests.length = 0;
    receiverMode = "ok";
    const row = await makeDelivery(`concurrent-${randomUUID()}`);

    // First caller claims and holds the delivery (simulated by not finishing);
    // a second concurrent call must observe the fresh claim and skip.
    const first = delivery.deliverOnce(row.dedupeKey, { backoffMs: [10] });
    await new Promise((resolve) => setTimeout(resolve, 50)); // claim taken, send in flight
    await delivery.deliverOnce(row.dedupeKey);
    await first;

    expect((await prisma.webhookDelivery.findUniqueOrThrow({ where: { dedupeKey: row.dedupeKey } })).status).toBe("DELIVERED");
    expect(receiver.requests).toHaveLength(1);
  });

  it("keeps attempt budgets cumulative across recovery", async () => {
    receiver.requests.length = 0;
    receiverMode = "fail";
    const row = await makeDelivery(`budget-${randomUUID()}`, { attempts: 2 }); // one attempt left

    await delivery.deliverOnce(row.dedupeKey, { backoffMs: [10, 10] });
    const after = await prisma.webhookDelivery.findUniqueOrThrow({ where: { dedupeKey: row.dedupeKey } });
    expect(after.status).toBe("FAILED");
    expect(after.attempts).toBe(3); // 2 prior + 1 final attempt, then terminal
    expect(receiver.requests).toHaveLength(1);
    receiverMode = "ok";
  });

  it("operator requeue grants a fresh budget", async () => {
    receiver.requests.length = 0;
    receiverMode = "ok";
    const row = await makeDelivery(`requeue-${randomUUID()}`, { status: "FAILED" as never, attempts: 3, error: "old" });
    await webhooks.requeueDelivery(project.id, alice.user.id, hook.id, row.id);
    const reset = await prisma.webhookDelivery.findUniqueOrThrow({ where: { dedupeKey: row.dedupeKey } });
    expect(reset.status).toBe("PENDING");
    expect(reset.attempts).toBe(0);

    // The requeue is audited without leaking the signing secret.
    const auditRows = await prisma.auditLog.findMany({
      where: { projectId: project.id, action: "webhook.delivery_requeued" }
    });
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(auditRows[0].detail)).not.toContain(hook.signingSecret);
    expect(JSON.stringify(auditRows[0].detail)).toContain(row.id);

    await delivery.deliverOnce(row.dedupeKey);
    expect((await prisma.webhookDelivery.findUniqueOrThrow({ where: { dedupeKey: row.dedupeKey } })).status).toBe("DELIVERED");
    expect(receiver.requests).toHaveLength(1);
  });

  it("requeues only FAILED deliveries of the right endpoint", async () => {
    receiver.requests.length = 0;
    receiverMode = "ok";
    // Delivered row: idempotent requeue must be rejected, not double-send.
    const deliveredRow = await makeDelivery(`delv-${randomUUID()}`, { status: "DELIVERED" as never, attempts: 1 });
    await expect(webhooks.requeueDelivery(project.id, alice.user.id, hook.id, deliveredRow.id)).rejects.toMatchObject({
      status: 409
    });
    // Pending row: already queued, so another requeue must conflict.
    const pendingRow = await makeDelivery(`pend-${randomUUID()}`);
    await expect(webhooks.requeueDelivery(project.id, alice.user.id, hook.id, pendingRow.id)).rejects.toMatchObject({
      status: 409
    });
    expect((await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: pendingRow.id } })).attempts).toBe(0);
    // Unknown delivery id: 404, no state change.
    await expect(webhooks.requeueDelivery(project.id, alice.user.id, hook.id, "no-such-delivery")).rejects.toMatchObject({
      status: 404
    });
    // Broken endpoint scoping: a delivery on another endpoint of the project is 404.
    const otherHook = await webhooks.create(project.id, alice.user.id, { url: serverUrl });
    const otherRow = await makeDelivery(`other-${randomUUID()}`, { status: "FAILED" as never, attempts: 3, endpointId: otherHook.id });
    await expect(webhooks.requeueDelivery(project.id, alice.user.id, hook.id, otherRow.id)).rejects.toMatchObject({
      status: 404
    });
    await webhooks.delete(project.id, alice.user.id, otherHook.id);
  });

  it("blocks cross-tenant requeues (idor)", async () => {
    const otherHookRow = await webhooks.create(
      otherProject.id,
      bob.user.id,
      { url: serverUrl }
    );
    const foreignRow = await prisma.webhookDelivery.create({
      data: {
        endpointId: otherHookRow.id,
        projectId: otherProject.id,
        dedupeKey: `foreign-${randomUUID()}`,
        payload: { type: "alert.triggered" } as object,
        status: "FAILED" as never,
        attempts: 3
      }
    });
    // Alice (not a member of otherProject) cannot requeue that delivery
    // through her own project or through it.
    await expect(webhooks.requeueDelivery(otherProject.id, alice.user.id, otherHookRow.id, foreignRow.id)).rejects.toMatchObject({ status: 404 });
    await expect(webhooks.requeueDelivery(project.id, alice.user.id, hook.id, foreignRow.id)).rejects.toMatchObject({ status: 404 });
    expect((await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: foreignRow.id } })).status).toBe("FAILED");
    await prisma.webhookDelivery.delete({ where: { id: foreignRow.id } });
    await webhooks.delete(otherProject.id, bob.user.id, otherHookRow.id);
  });

  it("survives concurrent operator requeues with a single winner", async () => {
    receiver.requests.length = 0;
    receiverMode = "ok";
    const row = await makeDelivery(`race-${randomUUID()}`, { status: "FAILED" as never, attempts: 3 });
    const outcome = await Promise.allSettled([
      webhooks.requeueDelivery(project.id, alice.user.id, hook.id, row.id),
      webhooks.requeueDelivery(project.id, alice.user.id, hook.id, row.id)
    ]);
    const succeeded = outcome.filter((r) => r.status === "fulfilled");
    const conflicted = outcome.filter((r) => r.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(conflicted).toHaveLength(1);
    expect((conflicted[0] as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    const raced = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: row.id } });
    expect(raced.status).toBe("PENDING");
    expect(raced.attempts).toBe(0);
    await delivery.deliverOnce(row.dedupeKey);
    expect(receiver.requests).toHaveLength(1);
  });
});
