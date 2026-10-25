import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { UserGuard } from "../auth/session.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.service";
import { ProjectAccessGuard } from "../projects/project-access.guard";
import { CreateWebhookDto, UpdateWebhookDto } from "./dto/webhook.dto";
import { WebhooksService } from "./webhooks.service";

@UseGuards(UserGuard, ProjectAccessGuard)
@Controller("projects/:projectId/webhooks")
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string) {
    return this.webhooks.list(projectId, user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() dto: CreateWebhookDto
  ) {
    return this.webhooks.create(projectId, user.id, dto);
  }

  @Patch(":webhookId")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("webhookId") webhookId: string,
    @Body() dto: UpdateWebhookDto
  ) {
    return this.webhooks.update(projectId, user.id, webhookId, dto);
  }

  @Delete(":webhookId")
  delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("webhookId") webhookId: string
  ) {
    return this.webhooks.delete(projectId, user.id, webhookId);
  }

  @Get(":webhookId/deliveries")
  deliveries(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("webhookId") webhookId: string,
    @Query("limit") limit?: string
  ) {
    const parsed = Number(limit ?? "20");
    return this.webhooks.listDeliveries(projectId, user.id, webhookId, Number.isFinite(parsed) ? parsed : 20);
  }
}
