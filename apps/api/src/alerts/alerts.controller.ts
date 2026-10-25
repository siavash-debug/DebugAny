import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { UserGuard } from "../auth/session.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.service";
import { ProjectAccessGuard } from "../projects/project-access.guard";
import { CreateAlertRuleDto, UpdateAlertRuleDto } from "./dto/alert-rule.dto";
import { AlertsService } from "./alerts.service";

@UseGuards(UserGuard, ProjectAccessGuard)
@Controller("projects/:projectId/alerts")
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string) {
    return this.alerts.list(projectId, user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() dto: CreateAlertRuleDto
  ) {
    return this.alerts.create(projectId, user.id, dto);
  }

  @Patch(":ruleId")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("ruleId") ruleId: string,
    @Body() dto: UpdateAlertRuleDto
  ) {
    return this.alerts.update(projectId, user.id, ruleId, dto);
  }

  @Delete(":ruleId")
  delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("ruleId") ruleId: string
  ) {
    return this.alerts.delete(projectId, user.id, ruleId);
  }
}
