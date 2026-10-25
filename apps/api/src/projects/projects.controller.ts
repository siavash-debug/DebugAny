import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { UserGuard } from "../auth/session.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.service";
import { ProjectAccessGuard } from "./project-access.guard";
import { RequireOwner } from "./require-owner.decorator";
import { CurrentProject, type AccessibleProject } from "./current-project.decorator";
import { CreateKeyDto, CreateProjectDto, UpdateProjectDto } from "./dto/project.dto";
import { ProjectsService } from "./projects.service";

@UseGuards(UserGuard)
@Controller("projects")
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.projects.listWithRoles(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProjectDto) {
    return this.projects.create(user, dto);
  }

  @Get(":projectId")
  @UseGuards(ProjectAccessGuard)
  get(@CurrentProject() project: AccessibleProject) {
    return { project };
  }

  @Patch(":projectId")
  @UseGuards(ProjectAccessGuard)
  @RequireOwner()
  update(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() project: AccessibleProject,
    @Body() dto: UpdateProjectDto
  ) {
    return this.projects.update(user, project.id, dto);
  }

  @Delete(":projectId")
  @UseGuards(ProjectAccessGuard)
  @RequireOwner()
  delete(@CurrentUser() user: AuthenticatedUser, @CurrentProject() project: AccessibleProject) {
    return this.projects.delete(user, project.id);
  }

  // ---- ingestion keys ----

  @Get(":projectId/keys")
  @UseGuards(ProjectAccessGuard)
  listKeys(@CurrentUser() user: AuthenticatedUser, @CurrentProject() project: AccessibleProject) {
    return this.projects.listKeys(project.id, user.id);
  }

  @Post(":projectId/keys")
  @UseGuards(ProjectAccessGuard)
  createKey(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() project: AccessibleProject,
    @Body() dto: CreateKeyDto
  ) {
    return this.projects.createKey(user, project.id, dto);
  }

  @Post(":projectId/keys/:keyId/rotate")
  @UseGuards(ProjectAccessGuard)
  @RequireOwner()
  rotateKey(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() project: AccessibleProject,
    @Param("keyId") keyId: string
  ) {
    return this.projects.rotateKey(user, project.id, keyId);
  }

  @Delete(":projectId/keys/:keyId")
  @UseGuards(ProjectAccessGuard)
  revokeKey(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() project: AccessibleProject,
    @Param("keyId") keyId: string
  ) {
    return this.projects.revokeKey(user, project.id, keyId);
  }
}
