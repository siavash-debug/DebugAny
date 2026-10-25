import { Inject, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import type { ProjectRef } from "../auth/ingestion-key.guard";
import { CreateEventDto } from "./dto/create-event.dto";
import { EVENTS_QUEUE_TOKEN, EventJobData } from "../queue/queue.module";
import { env } from "../config/env";
import { IngestionCoreService } from "./ingestion-core.service";

/**
 * Ingestion entry point.
 *
 * Delivery guarantees:
 * - sync mode (default): the event is persisted transactionally before the
 *   202 is sent; HTTP 202 means stored.
 * - queue mode (DEBUGANY_INGESTION_MODE_QUEUE=true): 202 means the job is
 *   durably enqueued in Redis (BullMQ persists jobs); the worker persists it
 *   at-least-once with per-job idempotency, so retries never duplicate events
 *   or issue counts. This is at-least-once, not exactly-once.
 * - if Redis is unavailable in queue mode, the API falls back to synchronous
 *   persistence so accepted events are never silently dropped; the response
 *   reports which path was taken.
 */
export type IngestResponse =
  | { accepted: true; event: { id: string; occurredAt: Date; createdAt: Date }; issue: { id: string; fingerprint: string; firstSeenAt: Date } }
  | { accepted: true; queued: true; jobId: string }
  | { accepted: true; queued: false; degraded: true; event: { id: string; occurredAt: Date; createdAt: Date }; issue: { id: string } };

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly core: IngestionCoreService,
    @Inject(EVENTS_QUEUE_TOKEN) private readonly eventsQueue: Queue<EventJobData>
  ) {}

  async ingest(project: ProjectRef, dto: CreateEventDto): Promise<IngestResponse> {
    const input = {
      message: dto.message,
      errorType: dto.errorType,
      stackTrace: dto.stackTrace,
      environment: dto.environment,
      release: dto.release,
      occurredAt: (dto.occurredAt ? new Date(dto.occurredAt) : new Date()).toISOString(),
      metadata: dto.metadata
    };

    if (env.ingestionViaQueue) {
      const jobId = randomUUID();
      try {
        await this.eventsQueue.add("event", { jobId, project, event: input }, { jobId });
        return { accepted: true, queued: true, jobId };
      } catch (error) {
        // Redis outage: degrade to synchronous persistence rather than drop.
        this.logger.error(
          `Queue unavailable, persisting synchronously: ${error instanceof Error ? error.message : error}`
        );
        const result = await this.core.processEvent(project, input, jobId);
        return { accepted: true, queued: false, degraded: true, event: result.event, issue: { id: result.issue.id } };
      }
    }

    const result = await this.core.processEvent(project, input, randomUUID());
    return {
      accepted: true,
      event: result.event,
      issue: { id: result.issue.id, fingerprint: result.issue.fingerprint, firstSeenAt: result.issue.firstSeenAt }
    };
  }
}
