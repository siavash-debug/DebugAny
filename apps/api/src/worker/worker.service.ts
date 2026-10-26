import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker, type Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { IngestionCoreService } from "../events/ingestion-core.service";
import { AlertsService } from "../alerts/alerts.service";
import { WebhookDeliveryService } from "../webhooks/delivery.service";
import { DELIVERIES_QUEUE, DELIVERIES_QUEUE_TOKEN, EVENTS_QUEUE, EVENTS_QUEUE_TOKEN, QUEUE_CONNECTION, type DeliveryJobData, type EventJobData } from "../queue/queue.module";

export interface WorkerHealth {
  running: boolean;
  events: { processed: number; failed: number };
  deliveries: { processed: number; failed: number };
}

/**
 * Consumes the events and webhook delivery queues. Events are persisted
 * through the same transactional core as synchronous ingestion, with per-job
 * idempotency, then alert rules are evaluated. Delivery jobs send signed
 * webhooks with bounded retries; final failures are recorded on the delivery
 * row for inspection.
 */
@Injectable()
export class WorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerService.name);
  private eventsWorker?: Worker<EventJobData>;
  private deliveriesWorker?: Worker<DeliveryJobData>;
  private readonly health: WorkerHealth = {
    running: false,
    events: { processed: 0, failed: 0 },
    deliveries: { processed: 0, failed: 0 }
  };
  private recoveryTimer?: ReturnType<typeof setInterval>;
  private recoveryTimeoutMs = 10_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly core: IngestionCoreService,
    private readonly alerts: AlertsService,
    private readonly delivery: WebhookDeliveryService,
    @Inject(EVENTS_QUEUE_TOKEN) private readonly eventsQueue: Queue,
    @Inject(DELIVERIES_QUEUE_TOKEN) private readonly deliveriesQueue: Queue
  ) {}

  onModuleInit(): void {
    this.start();
  }

  start(): void {
    this.eventsWorker = new Worker<EventJobData>(
      EVENTS_QUEUE,
      async (job) => {
        const result = await this.core.processEvent(job.data.project, job.data.event, job.data.jobId);
        if (!result.duplicate) {
          const issue = await this.prisma.issue.findUniqueOrThrow({
            where: { id: result.issue.id },
            select: { id: true, fingerprint: true, title: true, count: true }
          });
          await this.alerts.evaluateForEvent(
            job.data.project,
            issue,
            result.issueCreated,
            job.data.event.occurredAt ? new Date(job.data.event.occurredAt) : new Date()
          );
        }
        return { eventId: result.event.id, duplicate: result.duplicate === true };
      },
      { connection: QUEUE_CONNECTION, concurrency: 5, lockDuration: 60_000 }
    );
    this.eventsWorker.on("completed", () => this.health.events.processed++);
    this.eventsWorker.on("failed", (job, error) => {
      this.health.events.failed++;
      this.logger.error(`Event job ${job?.id ?? "?"} failed (attempt ${job?.attemptsMade ?? "?"}): ${error.message}`);
    });

    this.deliveriesWorker = new Worker<DeliveryJobData>(
      DELIVERIES_QUEUE,
      async (job) => {
        await this.delivery.deliverOnce(job.data.deliveryKey);
      },
      // Webhook retries happen inside deliverOnce (bounded backoff); one queue
      // attempt is enough, and failures remain inspectable via delivery rows.
      // lockDuration spans the worst-case in-job budget (3 attempts x 10s
      // timeout + backoff ~ 34s) so a legitimately slow send is never declared
      // stalled and reclaimed beyond the row-level claim.
      {
        connection: QUEUE_CONNECTION,
        concurrency: 5,
        lockDuration: 60_000
      }
    );
    this.deliveriesWorker.on("completed", () => this.health.deliveries.processed++);
    this.deliveriesWorker.on("failed", (job, error) => {
      this.health.deliveries.failed++;
      this.logger.error(`Delivery job ${job?.id ?? "?"} failed: ${error.message}`);
    });

    this.health.running = true;
    this.logger.log("Workers started (events, deliveries)");

    // Recover deliveries abandoned by a previous worker (crash mid-send),
    // then sweep periodically. Bounded batch per sweep prevents storms.
    const firstRecovery = setTimeout(() => {
      void this.delivery.recoverAbandoned().catch((error) =>
        this.logger.error(`Startup recovery failed: ${error instanceof Error ? error.message : error}`)
      );
    }, 5_000);
    firstRecovery.unref?.();
    this.recoveryTimer = setInterval(() => {
      void this.delivery.recoverAbandoned().catch((error) =>
        this.logger.error(`Recovery sweep failed: ${error instanceof Error ? error.message : error}`)
      );
    }, 5 * 60_000);
    this.recoveryTimer.unref?.();
  }

  /** Queue backlog signals for the health endpoint. */
  async queueBacklog(): Promise<{ events: { waiting: number; failed: number }; deliveries: { waiting: number; failed: number } } | null> {
    try {
      const [eventsWaiting, eventsFailed, deliveriesWaiting, deliveriesFailed] = await Promise.all([
        this.eventsQueue.getWaitingCount(),
        this.eventsQueue.getFailedCount(),
        this.deliveriesQueue.getWaitingCount(),
        this.deliveriesQueue.getFailedCount()
      ]);
      return {
        events: { waiting: eventsWaiting, failed: eventsFailed },
        deliveries: { waiting: deliveriesWaiting, failed: deliveriesFailed }
      };
    } catch {
      return null; // Redis unreachable
    }
  }

  getHealth(): WorkerHealth {
    return { ...this.health, events: { ...this.health.events }, deliveries: { ...this.health.deliveries } };
  }

  /** Stops accepting jobs and waits for the active ones within a bounded timeout. */
  async onModuleDestroy(): Promise<void> {
    this.health.running = false;
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = undefined;
    }
    const deadline = Date.now() + this.recoveryTimeoutMs;
    for (const worker of [this.eventsWorker, this.deliveriesWorker]) {
      if (worker) {
        const remaining = deadline - Date.now();
        await Promise.race([
          worker.close(),
          new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, Math.max(remaining, 0));
            timer.unref?.();
          })
        ]);
      }
    }
    this.logger.log("Workers stopped gracefully");
  }

}
