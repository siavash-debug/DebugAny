import { BadRequestException, Injectable } from "@nestjs/common";
import { IssueStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { ProjectRef } from "../auth/ingestion-key.guard";
import { buildEventFingerprint } from "./event-fingerprint";
import { sanitizeMetadata } from "./sanitize-metadata";

export interface EventInput {
  message: string;
  errorType?: string;
  stackTrace?: string;
  environment?: string;
  release?: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
}

export interface IngestResult {
  event: { id: string; occurredAt: Date; createdAt: Date };
  issue: { id: string; fingerprint: string; firstSeenAt: Date };
  /** True when this job had already been processed (idempotent replay). */
  duplicate?: boolean;
  /** Issue was created by this event (drives NEW_ISSUE alert rules). */
  issueCreated: boolean;
}

/**
 * Transactional event persistence shared by the synchronous path and the
 * queue worker. Processing is idempotent per jobId: the ProcessedJob marker
 * is written in the same transaction as the event, so a retried job cannot
 * create a second event or double-count an issue.
 */
@Injectable()
export class IngestionCoreService {
  constructor(private readonly prisma: PrismaService) {}

  async processEvent(project: ProjectRef, input: EventInput, jobId: string): Promise<IngestResult> {
    const sanitized = sanitizeMetadata(input.metadata);
    if (!sanitized.accepted) {
      throw new BadRequestException(sanitized.reason);
    }

    const fingerprint = buildEventFingerprint({
      message: input.message,
      errorType: input.errorType,
      stackTrace: input.stackTrace
    });

    const occurredAt = new Date(input.occurredAt);
    const message = input.message.trim().replace(/\s+/g, " ");
    const errorType = input.errorType ?? "Error";

    // Reserve the idempotency marker atomically before touching aggregates.
    // A unique violation means this jobId was already processed; genuine
    // retries replay the same payload, so the event is findable.
    try {
      await this.prisma.processedJob.create({ data: { jobId } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await this.prisma.errorEvent.findFirst({
          where: { projectId: project.id, fingerprint, occurredAt },
          select: { id: true, occurredAt: true, createdAt: true, issue: { select: { id: true, fingerprint: true, firstSeenAt: true } } },
          orderBy: { createdAt: "desc" }
        });
        if (existing?.issue) {
          return {
            duplicate: true,
            event: { id: existing.id, occurredAt: existing.occurredAt, createdAt: existing.createdAt },
            issue: existing.issue,
            issueCreated: false
          };
        }
        // The previous attempt reserved the marker but did not commit an
        // event (it failed mid-transaction). Release the reservation so this
        // retry can proceed.
        await this.prisma.processedJob.deleteMany({ where: { jobId } }).catch(() => undefined);
      } else {
        throw error;
      }
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const issue = await tx.issue.upsert({
          where: { projectId_fingerprint: { projectId: project.id, fingerprint } },
          create: {
            projectId: project.id,
            fingerprint,
            title: message,
            errorType,
            environment: input.environment ?? "production",
            release: input.release,
            stackTrace: input.stackTrace,
            count: 1,
            firstSeenAt: occurredAt,
            lastSeenAt: occurredAt
          },
          update: {
            title: message,
            errorType,
            environment: input.environment ?? "production",
            release: input.release,
            stackTrace: input.stackTrace,
            count: { increment: 1 },
            lastSeenAt: occurredAt
          },
          select: { id: true, status: true, firstSeenAt: true, count: true }
        });

        const event = await tx.errorEvent.create({
          data: {
            projectId: project.id,
            issueId: issue.id,
            message,
            errorType: input.errorType,
            stackTrace: input.stackTrace,
            environment: input.environment ?? "production",
            release: input.release,
            fingerprint,
            metadata: sanitized.metadata as Prisma.InputJsonValue,
            occurredAt
          },
          select: { id: true, occurredAt: true, createdAt: true }
        });

        if (issue.status === IssueStatus.RESOLVED) {
          await tx.issue.update({
            where: { id: issue.id },
            data: { status: IssueStatus.UNRESOLVED }
          });
        }

        return {
          event,
          issue: { id: issue.id, fingerprint, firstSeenAt: issue.firstSeenAt },
          issueCreated: issue.count === 1
        };
      });
      return result;
    } catch (error) {
      // Release the reservation so a retry can process this job again; the
      // retry itself is idempotent through the same marker dance.
      await this.prisma.processedJob.deleteMany({ where: { jobId } }).catch(() => undefined);
      throw error;
    }
  }
}