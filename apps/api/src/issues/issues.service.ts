import { Injectable, NotFoundException } from "@nestjs/common";
import { IssueStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { ProjectRef } from "../auth/ingestion-key.guard";
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
  constructor(private readonly prisma: PrismaService) {}

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

  async list(project: ProjectRef, query: ListIssuesQueryDto) {
    const where = this.buildWhere(project.id, query);
    const [issues, total, totalEvents] = await this.prisma.$transaction([
      this.prisma.issue.findMany({
        where,
        orderBy: { lastSeenAt: "desc" },
        take: query.limit,
        skip: query.offset,
        select: ISSUE_LIST_SELECT
      }),
      this.prisma.issue.count({ where }),
      this.prisma.errorEvent.count({ where: { projectId: project.id } })
    ]);

    return {
      project: { id: project.id, name: project.name, slug: project.slug },
      issues,
      total,
      totalEvents,
      limit: query.limit,
      offset: query.offset
    };
  }

  async getWithEvents(project: ProjectRef, issueId: string, eventLimit: number, eventOffset: number) {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, projectId: project.id },
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

    return { project: { id: project.id, name: project.name, slug: project.slug }, issue, events, totalEvents };
  }

  async updateStatus(project: ProjectRef, issueId: string, status: IssueStatus) {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, projectId: project.id },
      select: { id: true }
    });
    if (!issue) {
      throw new NotFoundException("Issue not found.");
    }

    return this.prisma.issue.update({
      where: { id: issue.id },
      data: { status },
      select: { ...ISSUE_LIST_SELECT }
    });
  }

  /** Counts used by the dashboard: total, unresolved, and new issues in a window. */
  async summary(project: ProjectRef, since: Date) {
    const [totalEvents, totalIssues, unresolved, newIssues] = await this.prisma.$transaction([
      this.prisma.errorEvent.count({ where: { projectId: project.id, occurredAt: { gte: since } } }),
      this.prisma.issue.count({ where: { projectId: project.id } }),
      this.prisma.issue.count({ where: { projectId: project.id, status: IssueStatus.UNRESOLVED } }),
      this.prisma.issue.count({ where: { projectId: project.id, firstSeenAt: { gte: since } } })
    ]);
    return { totalEvents, totalIssues, unresolved, newIssues };
  }
}
