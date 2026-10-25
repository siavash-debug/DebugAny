import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { UserGuard } from "../auth/session.guard";
import { ProjectAccessGuard } from "../projects/project-access.guard";
import { OverviewQueryDto } from "./dto/overview-query.dto";
import { MetricsService } from "./metrics.service";

@UseGuards(UserGuard, ProjectAccessGuard)
@Controller("projects/:projectId/metrics")
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get("overview")
  overview(@Param("projectId") projectId: string, @Query() query: OverviewQueryDto) {
    return this.metricsService.overview(projectId, query.windowHours ?? 24);
  }
}
