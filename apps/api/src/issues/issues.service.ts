import { Injectable, NotFoundException } from "@nestjs/common";
import { IssueStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ListIssuesQueryDto } from "./dto/list-issues-query.dto";

const ISSUE_LIST_SELECT = {
  id: true,
  fingerprint: true,
  title: true,
  errorType: true,
  environment: true,
  release: true,
  status: true,
  count: true,
  firstSeenAt: true,
  lastSeenAt: true
} satisfies Prisma.IssueSelect;

@Injectable()
export class IssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  private buildWhere(projectId: string, query: ListIssuesQueryDto): Prisma.IssueWhereInput {
    const where: Prisma.IssueWhereInput = { projectId };
    if (query.status) where.status = query.status;
    if (query.environment) where.environment = query.environment;
    if (query.search) where.title = { contains: query.search, mode: "insensitive" };
    if (query.since || query.until) {
      where.lastSeenAt = {
        ...(query.since ? { gte: new Date(query.since) } : {}),
        ...(query.until ? { lte: new Date(query.until) } : {})
      };
    }
    return where;
  }

  async list(projectId: string, query: ListIssuesQueryDto) {
    const where = this.buildWhere(projectId, query);
    const [issues, total, totalEvents] = await this.prisma.$transaction([
      this.prisma.issue.findMany({
        where,
        orderBy: { lastSeenAt: "desc" },
        take: query.limit,
        skip: query.offset,
        select: ISSUE_LIST_SELECT
      }),
      this.prisma.issue.count({ where }),
      this.prisma.errorEvent.count({ where: { projectId } })
    ]);

    return {
      issues,
      total,
      totalEvents,
      limit: query.limit,
      offset: query.offset
    };
  }

  async getWithEvents(projectId: string, issueId: string, eventLimit: number, eventOffset: number) {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, projectId },
      select: {
        ...ISSUE_LIST_SELECT,
        stackTrace: true,
        createdAt: true,
        updatedAt: true
      }
    });
    if (!issue) {
      throw new NotFoundException("Issue not found.");
    }

    const [events, totalEvents] = await this.prisma.$transaction([
      this.prisma.errorEvent.findMany({
        where: { issueId: issue.id },
        orderBy: { occurredAt: "desc" },
        take: eventLimit,
        skip: eventOffset,
        select: {
          id: true,
          message: true,
          errorType: true,
          environment: true,
          release: true,
          metadata: true,
          occurredAt: true,
          createdAt: true
        }
      }),
      this.prisma.errorEvent.count({ where: { issueId: issue.id } })
    ]);

    return { issue, events, totalEvents };
  }

  async updateStatus(projectId: string, issueId: string, status: IssueStatus, userId: string) {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, projectId },
      select: { id: true }
    });
    if (!issue) {
      throw new NotFoundException("Issue not found.");
    }

    const updated = await this.prisma.issue.update({
      where: { id: issue.id },
      data: { status },
      select: { ...ISSUE_LIST_SELECT }
    });
    await this.audit.record(this.prisma, {
      projectId,
      userId,
      action: "issue.status_changed",
      detail: { issueId, status }
    });
    return updated;
  }

  /** Counts used by the dashboard: total, unresolved, and new issues in a window. */
  async summary(projectId: string, since: Date) {
    const [totalEvents, totalIssues, unresolved, newIssues] = await this.prisma.$transaction([
      this.prisma.errorEvent.count({ where: { projectId, occurredAt: { gte: since } } }),
      this.prisma.issue.count({ where: { projectId } }),
      this.prisma.issue.count({ where: { projectId, status: IssueStatus.UNRESOLVED } }),
      this.prisma.issue.count({ where: { projectId, firstSeenAt: { gte: since } } })
    ]);
    return { totalEvents, totalIssues, unresolved, newIssues };
  }
}
