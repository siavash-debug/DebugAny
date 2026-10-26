import { BadRequestException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectsService } from "../projects/projects.service";
import type { AuthenticatedUser } from "../auth/auth.service";
import { AuditService } from "../audit/audit.service";
import { encryptSecret, generateWebhookSecret } from "./crypto";
import { assertPublicWebhookHost } from "./ssrf";
import { env } from "../config/env";
import { CreateWebhookDto, UpdateWebhookDto } from "./dto/webhook.dto";
import { WebhookDeliveryService } from "./delivery.service";

const WEBHOOK_SELECT = {
  id: true,
  url: true,
  name: true,
  enabled: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.WebhookEndpointSelect;

const DELIVERY_SELECT = {
  id: true,
  alertRuleId: true,
  dedupeKey: true,
  status: true,
  attempts: true,
  responseStatus: true,
  error: true,
  createdAt: true,
  deliveredAt: true
} satisfies Prisma.WebhookDeliverySelect;

@Injectable()
export class WebhooksService {
  /** SSRF pre-flight; overridable in tests to target a local receiver. */
  async checkUrl(url: string): Promise<void> {
    try {
      await assertPublicWebhookHost(url);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Webhook URL rejected");
    }
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly audit: AuditService,
    @Optional() private readonly delivery?: WebhookDeliveryService
  ) {}

  async list(projectId: string, userId: string) {
    await this.projects.requireMember(projectId, userId);
    return this.prisma.webhookEndpoint.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
      select: WEBHOOK_SELECT
    });
  }

  async create(projectId: string, userId: string, dto: CreateWebhookDto) {
    await this.projects.requireMember(projectId, userId);
    if (!env.encryptionKey) {
      throw new ServiceUnavailableException(
        "Webhook secrets require DEBUGANY_ENCRYPTION_KEY to be configured on the server."
      );
    }
    // Fail fast on loopback/private/metadata destinations.
    await this.checkUrl(dto.url);

    // The signing secret is returned exactly once; it is stored encrypted.
    const secret = generateWebhookSecret();
    const webhook = await this.prisma.$transaction(async (tx) => {
      const created = await tx.webhookEndpoint.create({
        data: {
          projectId,
          url: dto.url,
          name: dto.name,
          secretEnc: encryptSecret(secret)
        },
        select: WEBHOOK_SELECT
      });
      await this.audit.record(tx, {
        projectId,
        userId,
        action: "webhook.created",
        detail: { webhookId: created.id, url: dto.url }
      });
      return created;
    });
    return { ...webhook, signingSecret: secret };
  }

  async update(projectId: string, userId: string, webhookId: string, dto: UpdateWebhookDto) {
    await this.projects.requireMember(projectId, userId);
    const existing = await this.prisma.webhookEndpoint.findFirst({
      where: { id: webhookId, projectId },
      select: { id: true }
    });
    if (!existing) {
      throw new NotFoundException("Webhook not found.");
    }
    if (dto.url) {
      await this.checkUrl(dto.url);
    }
    return this.prisma.webhookEndpoint.update({
      where: { id: existing.id },
      data: {
        ...(dto.url !== undefined ? { url: dto.url } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {})
      },
      select: WEBHOOK_SELECT
    });
  }

  async delete(projectId: string, userId: string, webhookId: string) {
    await this.projects.requireMember(projectId, userId);
    const result = await this.prisma.webhookEndpoint.deleteMany({
      where: { id: webhookId, projectId }
    });
    if (result.count === 0) {
      throw new NotFoundException("Webhook not found.");
    }
    await this.audit.record(this.prisma, {
      projectId,
      userId,
      action: "webhook.deleted",
      detail: { webhookId }
    });
    return { deleted: true };
  }

  /**
   * Requeues a failed delivery for a member after verifying tenant scoping.
   * The delivery service enforces the FAILED-only precondition; we audit the
   * action without recording secrets or payloads.
   */
  async requeueDelivery(projectId: string, userId: string, webhookId: string, deliveryId: string) {
    await this.projects.requireMember(projectId, userId);
    const endpoint = await this.prisma.webhookEndpoint.findFirst({
      where: { id: webhookId, projectId },
      select: { id: true }
    });
    if (!endpoint) {
      throw new NotFoundException("Webhook not found.");
    }
    if (!this.delivery) {
      throw new ServiceUnavailableException("Delivery service is not available.");
    }
    const result = await this.delivery.requeueFailed(projectId, endpoint.id, deliveryId);
    await this.audit.record(this.prisma, {
      projectId,
      userId,
      action: "webhook.delivery_requeued",
      detail: { webhookId, deliveryId }
    });
    return result;
  }

  /** Delivery history for one endpoint, newest first, bounded page. */
  async listDeliveries(projectId: string, userId: string, webhookId: string, limit: number) {
    await this.projects.requireMember(projectId, userId);
    const endpoint = await this.prisma.webhookEndpoint.findFirst({
      where: { id: webhookId, projectId },
      select: { id: true }
    });
    if (!endpoint) {
      throw new NotFoundException("Webhook not found.");
    }
    return this.prisma.webhookDelivery.findMany({
      where: { endpointId: endpoint.id },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 50),
      select: DELIVERY_SELECT
    });
  }
}
