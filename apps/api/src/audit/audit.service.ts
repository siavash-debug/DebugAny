import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Append-only record of sensitive administrative actions. Rows intentionally
 * have no FK so they survive project deletion.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(
    tx: Prisma.TransactionClient | PrismaService,
    entry: { projectId?: string; userId?: string; action: string; detail?: Prisma.InputJsonValue }
  ): Promise<void> {
    try {
      await tx.auditLog.create({
        data: {
          projectId: entry.projectId,
          userId: entry.userId,
          action: entry.action,
          detail: entry.detail
        }
      });
    } catch (error) {
      // Audit failures must not roll back the primary action, but they must
      // be visible in server logs.
      this.logger.error({ action: entry.action, error: error instanceof Error ? error.message : error });
    }
  }
}
