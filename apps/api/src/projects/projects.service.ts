import {
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../auth/auth.service";
import { generateIngestionKey, keyPrefix, sha256 } from "../auth/tokens";
import type { CreateKeyDto, CreateProjectDto, UpdateProjectDto } from "./dto/project.dto";

export const PROJECT_LIST_SELECT = {
  id: true,
  name: true,
  slug: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.ProjectSelect;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  /** Returns only projects the user is a member of; isolation is enforced here, not in the UI. */
  async listWithRoles(userId: string) {
    const memberships = await this.prisma.projectMember.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        role: true,
        project: { select: PROJECT_LIST_SELECT }
      }
    });
    return memberships.map((m) => ({ ...m.project, role: m.role }));
  }

  async create(user: AuthenticatedUser, dto: CreateProjectDto) {
    let project;
    try {
      project = await this.prisma.$transaction(async (tx) => {
        const created = await tx.project.create({
          data: { name: dto.name, slug: dto.slug },
          select: PROJECT_LIST_SELECT
        });
        await tx.projectMember.create({
          data: { projectId: created.id, userId: user.id, role: "OWNER" }
        });
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("A project with this slug already exists.");
      }
      throw error;
    }
    await this.audit.record(this.prisma, {
      projectId: project.id,
      userId: user.id,
      action: "project.created",
      detail: { name: project.name, slug: project.slug }
    });
    return project;
  }

  /** Resolves the project only when the user is a member; returns null to avoid leaking existence. */
  async getForMember(projectId: string, userId: string) {
    const membership = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { role: true, project: { select: PROJECT_LIST_SELECT } }
    });
    return membership ? { ...membership.project, role: membership.role } : null;
  }

  async requireMember(projectId: string, userId: string) {
    const project = await this.getForMember(projectId, userId);
    if (!project) {
      throw new NotFoundException("Project not found.");
    }
    return project;
  }

  async update(user: AuthenticatedUser, projectId: string, dto: UpdateProjectDto) {
    await this.requireOwner(projectId, user.id);
    const project = await this.prisma.project.update({
      where: { id: projectId },
      data: { name: dto.name },
      select: PROJECT_LIST_SELECT
    });
    await this.audit.record(this.prisma, {
      projectId,
      userId: user.id,
      action: "project.updated",
      detail: { name: project.name }
    });
    return project;
  }

  async delete(user: AuthenticatedUser, projectId: string) {
    await this.requireOwner(projectId, user.id);
    const project = await this.prisma.project.delete({
      where: { id: projectId },
      select: { id: true, slug: true }
    });
    await this.audit.record(this.prisma, {
      userId: user.id,
      action: "project.deleted",
      detail: { projectId: project.id, slug: project.slug }
    });
    return project;
  }

  private async requireOwner(projectId: string, userId: string) {
    const membership = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { role: true }
    });
    if (!membership) {
      throw new NotFoundException("Project not found.");
    }
    if (membership.role !== "OWNER") {
      throw new NotFoundException("Project not found.");
    }
  }

  // ---- ingestion keys ----

  async listKeys(projectId: string, userId: string) {
    await this.requireMember(projectId, userId);
    return this.prisma.ingestionKey.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        prefix: true,
        name: true,
        createdAt: true,
        lastUsedAt: true,
        revokedAt: true
      }
    });
  }

  async createKey(user: AuthenticatedUser, projectId: string, dto: CreateKeyDto) {
    await this.requireMember(projectId, user.id);
    const raw = generateIngestionKey();
    const key = await this.prisma.$transaction(async (tx) => {
      const created = await tx.ingestionKey.create({
        data: {
          projectId,
          keyHash: sha256(raw),
          prefix: keyPrefix(raw),
          name: dto.name,
          createdById: user.id
        },
        select: { id: true, prefix: true, name: true, createdAt: true }
      });
      await this.audit.record(tx, {
        projectId,
        userId: user.id,
        action: "key.created",
        detail: { keyId: created.id, prefix: created.prefix }
      });
      return created;
    });
    // The raw key is returned exactly once; only its hash is stored.
    return { ...key, key: raw };
  }

  /** Creates a replacement key and revokes the old one atomically. */
  async rotateKey(user: AuthenticatedUser, projectId: string, keyId: string) {
    await this.requireOwner(projectId, user.id);
    const raw = generateIngestionKey();
    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.ingestionKey.findFirst({
        where: { id: keyId, projectId, revokedAt: null },
        select: { id: true }
      });
      if (!existing) {
        throw new NotFoundException("Active key not found.");
      }
      const revoked = await tx.ingestionKey.update({
        where: { id: keyId },
        data: { revokedAt: new Date() },
        select: { id: true }
      });
      const created = await tx.ingestionKey.create({
        data: {
          projectId,
          keyHash: sha256(raw),
          prefix: keyPrefix(raw),
          name: "rotated",
          createdById: user.id
        },
        select: { id: true, prefix: true, name: true, createdAt: true }
      });
      await this.audit.record(tx, {
        projectId,
        userId: user.id,
        action: "key.rotated",
        detail: { revokedKeyId: revoked.id, createdKeyId: created.id, prefix: created.prefix }
      });
      return created;
    });
    return { ...result, key: raw };
  }

  async revokeKey(user: AuthenticatedUser, projectId: string, keyId: string) {
    await this.requireMember(projectId, user.id);
    const key = await this.prisma.ingestionKey.updateMany({
      where: { id: keyId, projectId, revokedAt: null },
      data: { revokedAt: new Date() }
    });
    if (key.count === 0) {
      throw new NotFoundException("Active key not found.");
    }
    await this.audit.record(this.prisma, {
      projectId,
      userId: user.id,
      action: "key.revoked",
      detail: { keyId }
    });
    return { revoked: true };
  }
}
