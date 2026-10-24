import { Injectable } from "@nestjs/common";
import { IssueStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { ProjectRef } from "../auth/ingestion-key.guard";

export interface SeriesBucket {
  /** ISO timestamp of the bucket start (UTC). */
  bucket: string;
  count: number;
}

@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(project: ProjectRef, windowHours: number) {
    const since = new Date(Date.now() - windowHours * 3_600_000);

    const [totalEvents, newIssues, unresolved, totalIssues, topIssues, rawSeries] = await this.prisma.$transaction([
      this.prisma.errorEvent.count({ where: { projectId: project.id, occurredAt: { gte: since } } }),
      this.prisma.issue.count({ where: { projectId: project.id, firstSeenAt: { gte: since } } }),
      this.prisma.issue.count({ where: { projectId: project.id, status: IssueStatus.UNRESOLVED } }),
      this.prisma.issue.count({ where: { projectId: project.id } }),
      this.prisma.issue.findMany({
        where: { projectId: project.id },
        orderBy: { count: "desc" },
        take: 5,
        select: { id: true, title: true, errorType: true, status: true, count: true, lastSeenAt: true }
      }),
      this.prisma.$queryRaw<Array<{ bucket: Date; count: bigint }>>`
        SELECT date_trunc('hour', "occurredAt") AS bucket, count(*) AS count
        FROM "ErrorEvent"
        WHERE "projectId" = ${project.id} AND "occurredAt" >= ${since}
        GROUP BY 1
        ORDER BY 1 ASC`
    ]);

    // Fill empty hours so the chart shows gaps as zero instead of skipping time.
    const counts = new Map<string, number>();
    for (const row of rawSeries) {
      counts.set(row.bucket.toISOString(), Number(row.count));
    }
    const series: SeriesBucket[] = [];
    const start = Math.floor(since.getTime() / 3_600_000) * 3_600_000;
    for (let t = start; t <= Date.now(); t += 3_600_000) {
      const iso = new Date(t).toISOString();
      series.push({ bucket: iso, count: counts.get(iso) ?? 0 });
    }

    return {
      project: { id: project.id, name: project.name, slug: project.slug },
      windowHours,
      totalEvents,
      newIssues,
      unresolved,
      totalIssues,
      topIssues,
      series
    };
  }
}
