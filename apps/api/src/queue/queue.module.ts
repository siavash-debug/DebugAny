import { Global, Module } from "@nestjs/common";
import { Queue } from "bullmq";
import { env } from "../config/env";
import { PrismaModule } from "../prisma/prisma.module";

export const EVENTS_QUEUE = "events";
export const DELIVERIES_QUEUE = "deliveries";

export interface DeliveryJobData {
  deliveryKey: string;
}

export interface EventJobData {
  /** Deterministic job id (also the ProcessedJob id) for end-to-end idempotency. */
  jobId: string;
  project: { id: string; name: string; slug: string };
  event: {
    message: string;
    errorType?: string;
    stackTrace?: string;
    environment?: string;
    release?: string;
    occurredAt: string;
    metadata?: Record<string, unknown>;
  };
}

const connection = { url: env.redisUrl };

function queueFactory(name: string): Queue {
  return new Queue(name, {
    connection,
    defaultJobOptions: {
      // Bounded exponential backoff; failed jobs stay inspectable in BullMQ.
      attempts: 5,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: { age: 3_600, count: 1_000 },
      removeOnFail: { age: 24 * 3_600 }
    }
  });
}

export const EVENTS_QUEUE_TOKEN = "EVENTS_QUEUE";
export const DELIVERIES_QUEUE_TOKEN = "DELIVERIES_QUEUE";
export const QUEUE_CONNECTION = connection;

@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    { provide: EVENTS_QUEUE_TOKEN, useFactory: () => queueFactory(EVENTS_QUEUE) },
    { provide: DELIVERIES_QUEUE_TOKEN, useFactory: () => queueFactory(DELIVERIES_QUEUE) }
  ],
  exports: [EVENTS_QUEUE_TOKEN, DELIVERIES_QUEUE_TOKEN]
})
export class QueueModule {}
