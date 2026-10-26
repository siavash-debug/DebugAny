import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { WorkerService } from "../src/worker/worker.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { IngestionCoreService } from "../src/events/ingestion-core.service";
import { AlertsService } from "../src/alerts/alerts.service";
import { WebhookDeliveryService } from "../src/webhooks/delivery.service";
import type { Queue } from "bullmq";

function queueStub(behavior: { waiting?: () => Promise<number>; failed?: () => Promise<number> } = {}): Queue {
  return {
    getWaitingCount: behavior.waiting ?? (async () => 0),
    getFailedCount: behavior.failed ?? (async () => 0)
  } as unknown as Queue;
}

function workerWithQueues(events: Queue, deliveries: Queue): WorkerService {
  const prisma = new PrismaService();
  const core = Object.create(IngestionCoreService.prototype) as IngestionCoreService;
  const alerts = Object.create(AlertsService.prototype) as AlertsService;
  const delivery = Object.create(WebhookDeliveryService.prototype) as WebhookDeliveryService;
  return new WorkerService(prisma, core, alerts, delivery, events, deliveries);
}

describe("WorkerService queueBacklog", () => {
  it("reports waiting and failed counts per queue", async () => {
    const worker = workerWithQueues(
      queueStub({ waiting: async () => 2, failed: async () => 1 }),
      queueStub({ waiting: async () => 5, failed: async () => 0 })
    );
    const backlog = await worker.queueBacklog();
    expect(backlog).toEqual({
      events: { waiting: 2, failed: 1 },
      deliveries: { waiting: 5, failed: 0 }
    });
  });

  it("survives a Redis outage by reporting null backlog instead of failing /v1/worker/health", async () => {
    const unreachable = queueStub({
      waiting: () => Promise.reject(new Error("redis down"))
    });
    const worker = workerWithQueues(unreachable, unreachable);
    const backlog = await worker.queueBacklog();
    expect(backlog).toBeNull();
  });

  it("getHealth reflects counters without touching Redis", async () => {
    const worker = workerWithQueues(queueStub(), queueStub());
    expect(worker.getHealth().running).toBe(false);
  });
});
