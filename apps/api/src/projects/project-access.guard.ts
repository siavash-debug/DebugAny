import { CanActivate, ExecutionContext, Injectable, NotFoundException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { ProjectsService } from "./projects.service";
import type { AuthenticatedUser } from "../auth/auth.service";

export const REQUIRE_OWNER = "requireProjectOwner";

interface ProjectRequest extends Request {
  user?: AuthenticatedUser;
  project?: { id: string; name: string; slug: string; role: string };
}

/**
 * Resolves the :projectId route parameter against the authenticated user's
 * memberships. Non-members always get 404 so project existence is not
 * disclosed across tenants.
 */
@Injectable()
export class ProjectAccessGuard implements CanActivate {
  constructor(
    private readonly projects: ProjectsService,
    private readonly reflector: Reflector
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ProjectRequest>();
    const user = request.user;
    if (!user) return false;

    const projectId = Array.isArray(request.params?.projectId)
      ? request.params.projectId[0]
      : request.params?.projectId;
    const project = await this.projects.getForMember(projectId, user.id);
    if (!project) {
      throw new NotFoundException("Project not found.");
    }
    const ownerOnly = this.reflector.getAllAndOverride<boolean>(REQUIRE_OWNER, [
      context.getHandler(),
      context.getClass()
    ]);
    if (ownerOnly && project.role !== "OWNER") {
      throw new NotFoundException("Project not found.");
    }
    request.project = project;
    return true;
  }
}
