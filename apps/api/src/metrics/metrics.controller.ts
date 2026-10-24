import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { IngestionKeyGuard } from "../auth/ingestion-key.guard";
import { IngestionProject } from "../auth/ingestion-project.decorator";
import type { ProjectRef } from "../auth/ingestion-key.guard";
import { OverviewQueryDto } from "./dto/overview-query.dto";
import { MetricsService } from "./metrics.service";

@UseGuards(IngestionKeyGuard)
@Controller("metrics")
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get("overview")
  overview(@IngestionProject() project: ProjectRef, @Query() query: OverviewQueryDto) {
    return this.metricsService.overview(project, query.windowHours ?? 24);
  }
}
