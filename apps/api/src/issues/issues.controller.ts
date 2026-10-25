import { Body, Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { UserGuard } from "../auth/session.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.service";
import { ProjectAccessGuard } from "../projects/project-access.guard";
import { GetIssueEventsQueryDto } from "./dto/get-issue-events-query.dto";
import { ListIssuesQueryDto } from "./dto/list-issues-query.dto";
import { UpdateIssueStatusDto } from "./dto/update-issue-status.dto";
import { IssuesService } from "./issues.service";

@UseGuards(UserGuard, ProjectAccessGuard)
@Controller("projects/:projectId/issues")
export class IssuesController {
  constructor(private readonly issuesService: IssuesService) {}

  @Get()
  list(@Param("projectId") projectId: string, @Query() query: ListIssuesQueryDto) {
    return this.issuesService.list(projectId, query);
  }

  @Get(":issueId")
  getWithEvents(
    @Param("projectId") projectId: string,
    @Param("issueId") issueId: string,
    @Query() query: GetIssueEventsQueryDto
  ) {
    return this.issuesService.getWithEvents(projectId, issueId, query.limit ?? 25, query.offset ?? 0);
  }

  @Patch(":issueId/status")
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("issueId") issueId: string,
    @Body() dto: UpdateIssueStatusDto
  ) {
    return this.issuesService.updateStatus(projectId, issueId, dto.status, user.id);
  }
}
