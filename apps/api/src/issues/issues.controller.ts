import { Body, Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { IngestionKeyGuard } from "../auth/ingestion-key.guard";
import { IngestionProject } from "../auth/ingestion-project.decorator";
import type { ProjectRef } from "../auth/ingestion-key.guard";
import { GetIssueEventsQueryDto } from "./dto/get-issue-events-query.dto";
import { ListIssuesQueryDto } from "./dto/list-issues-query.dto";
import { UpdateIssueStatusDto } from "./dto/update-issue-status.dto";
import { IssuesService } from "./issues.service";

@UseGuards(IngestionKeyGuard)
@Controller("issues")
export class IssuesController {
  constructor(private readonly issuesService: IssuesService) {}

  @Get()
  list(@IngestionProject() project: ProjectRef, @Query() query: ListIssuesQueryDto) {
    return this.issuesService.list(project, query);
  }

  @Get(":id")
  getWithEvents(
    @IngestionProject() project: ProjectRef,
    @Param("id") issueId: string,
    @Query() query: GetIssueEventsQueryDto
  ) {
    return this.issuesService.getWithEvents(project, issueId, query.limit ?? 25, query.offset ?? 0);
  }

  @Patch(":id/status")
  updateStatus(
    @IngestionProject() project: ProjectRef,
    @Param("id") issueId: string,
    @Body() dto: UpdateIssueStatusDto
  ) {
    return this.issuesService.updateStatus(project, issueId, dto.status);
  }
}
