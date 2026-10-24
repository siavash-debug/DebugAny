import { BadRequestException, Injectable } from "@nestjs/common";
import { IssueStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { ProjectRef } from "../auth/ingestion-key.guard";
import { buildEventFingerprint } from "./event-fingerprint";
import { CreateEventDto } from "./dto/create-event.dto";
import { sanitizeMetadata } from "./sanitize-metadata";

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists the event and its issue aggregate in one transaction. The response
   * is only sent once the transaction commits, so an HTTP 202 always means the
   * event is durably stored.
   *
   * Grouping rules:
   * - matching fingerprint → same issue; count and lastSeenAt advance
   * - the issue title/errorType/stack reflect the latest event
   * - a RESOLVED issue reopens when the same error occurs again; IGNORED stays
   */
  async ingest(project: ProjectRef, dto: CreateEventDto) {
    const sanitized = sanitizeMetadata(dto.metadata);
    if (!sanitized.accepted) {
      throw new BadRequestException(sanitized.reason);
    }

    const fingerprint = buildEventFingerprint({
      message: dto.message,
      errorType: dto.errorType,
      stackTrace: dto.stackTrace
    });

    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    const message = dto.message.trim().replace(/\s+/g, " ");
    const errorType = dto.errorType ?? "Error";

    const result = await this.prisma.$transaction(async (tx) => {
      const issue = await tx.issue.upsert({
        where: { projectId_fingerprint: { projectId: project.id, fingerprint } },
        create: {
          projectId: project.id,
          fingerprint,
          title: message,
          errorType,
          environment: dto.environment ?? "production",
          release: dto.release,
          stackTrace: dto.stackTrace,
          count: 1,
          firstSeenAt: occurredAt,
          lastSeenAt: occurredAt
        },
        update: {
          title: message,
          errorType,
          environment: dto.environment ?? "production",
          release: dto.release,
          stackTrace: dto.stackTrace,
          count: { increment: 1 },
          lastSeenAt: occurredAt
        },
        select: { id: true, status: true, firstSeenAt: true }
      });

      const event = await tx.errorEvent.create({
        data: {
          projectId: project.id,
          issueId: issue.id,
          message,
          errorType: dto.errorType,
          stackTrace: dto.stackTrace,
          environment: dto.environment ?? "production",
          release: dto.release,
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

      return { issue, event };
    });

    return {
      accepted: true,
      event: result.event,
      issue: {
        id: result.issue.id,
        fingerprint,
        firstSeenAt: result.issue.firstSeenAt
      }
    };
  }
}
