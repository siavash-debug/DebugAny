import { BadRequestException, Inject, Injectable, NotFoundException, Logger } from "@nestjs/common";
import { AlertRule, AlertRuleType, Prisma } from "@prisma/client";
import type { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectsService } from "../projects/projects.service";
import type { AuthenticatedUser } from "../auth/auth.service";
import { DELIVERIES_QUEUE_TOKEN, DELIVERIES_QUEUE, deliveryJobId } from "../queue/queue.module";
import { CreateAlertRuleDto, UpdateAlertRuleDto, validateRuleConfig, type AlertRuleConfig } from "./dto/alert-rule.dto";

const RULE_SELECT = {
  id: true,
  projectId: true,
  name: true,
  type: true,
  config: true,
  enabled: true,
  cooldownMinutes: true,
  webhookId: true,
  lastTriggeredAt: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.AlertRuleSelect;

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    @Inject(DELIVERIES_QUEUE_TOKEN) private readonly deliveriesQueue: Queue
  ) {}

  async list(projectId: string, userId: string) {
    await this.projects.requireMember(projectId, userId);
    return this.prisma.alertRule.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
      select: RULE_SELECT
    });
  }

  async create(projectId: string, userId: string, dto: CreateAlertRuleDto) {
    await this.projects.requireMember(projectId, userId);
    let config: AlertRuleConfig;
    try {
      config = validateRuleConfig(dto.type, dto.config);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Invalid rule config");
    }
    await this.assertWebhookIfSet(projectId, dto.webhookId);
    return this.prisma.alertRule.create({
      data: {
        projectId,
        name: dto.name,
        type: dto.type as AlertRuleType,
        config: config as Prisma.InputJsonValue,
        enabled: dto.enabled ?? true,
        cooldownMinutes: dto.cooldownMinutes ?? 60,
        webhookId: dto.webhookId
      },
      select: RULE_SELECT
    });
  }

  async update(projectId: string, userId: string, ruleId: string, dto: UpdateAlertRuleDto) {
    await this.projects.requireMember(projectId, userId);
    const existing = await this.prisma.alertRule.findFirst({
      where: { id: ruleId, projectId },
      select: { id: true, type: true, webhookId: true }
    });
    if (!existing) {
      throw new NotFoundException("Alert rule not found.");
    }
    const type = existing.type as AlertRuleType;
    if (dto.config !== undefined) {
      try {
        validateRuleConfig(type, dto.config);
      } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : "Invalid rule config");
      }
    }
    if (dto.webhookId) {
      await this.assertWebhookIfSet(projectId, dto.webhookId);
    }
    return this.prisma.alertRule.update({
      where: { id: existing.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.config !== undefined ? { config: dto.config as Prisma.InputJsonValue } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.cooldownMinutes !== undefined ? { cooldownMinutes: dto.cooldownMinutes } : {}),
        ...(dto.webhookId !== undefined ? { webhookId: dto.webhookId } : {})
      },
      select: RULE_SELECT
    });
  }

  async delete(projectId: string, userId: string, ruleId: string) {
    await this.projects.requireMember(projectId, userId);
    const result = await this.prisma.alertRule.deleteMany({
      where: { id: ruleId, projectId }
    });
    if (result.count === 0) {
      throw new NotFoundException("Alert rule not found.");
    }
    return { deleted: true };
  }

  private async assertWebhookIfSet(projectId: string, webhookId?: string) {
    if (!webhookId) return;
    const webhook = await this.prisma.webhookEndpoint.findFirst({
      where: { id: webhookId, projectId },
      select: { id: true }
    });
    if (!webhook) {
      throw new BadRequestException("webhookId does not reference a webhook of this project");
    }
  }

  /**
   * Evaluates all enabled rules of a project against a freshly ingested event.
   * Runs in the worker; never throws into ingestion. Triggered rules enqueue
   * one webhook delivery per target endpoint with a dedupe key so retries and
   * repeated evaluations cannot double-notify.
   */
  async evaluateForEvent(project: { id: string; name: string; slug: string }, issue: {
    id: string;
    fingerprint: string;
    title: string;
    count: number;
  }, issueCreated: boolean, occurredAt: Date): Promise<void> {
    try {
      const rules = await this.prisma.alertRule.findMany({
        where: { projectId: project.id, enabled: true },
        select: { ...RULE_SELECT }
      });
      if (rules.length === 0) return;

      const triggered: AlertRule[] = [];
      for (const rule of rules) {
        if (this.withinCooldown(rule)) continue;
        const matched = await this.matches(project.id, rule, issue, issueCreated, occurredAt);
        if (matched) triggered.push(rule);
      }
      if (triggered.length === 0) return;

      const now = new Date();
      await this.prisma.alertRule.updateMany({
        where: { id: { in: triggered.map((r) => r.id) } },
        data: { lastTriggeredAt: now }
      });

      for (const rule of triggered) {
        const endpoints = await this.prisma.webhookEndpoint.findMany({
          where: { projectId: project.id, enabled: true, ...(rule.webhookId ? { id: rule.webhookId } : {}) },
          select: { id: true }
        });
        for (const endpoint of endpoints) {
          // Dedupe key: rule + issue + the issue's occurrence bucket. Repeated
          // evaluation of the same trigger cannot create a second delivery.
          const dedupeKey = `${rule.id}:${issue.id}:${issue.count}`;
          const payload = {
            type: "alert.triggered",
            rule: { id: rule.id, name: rule.name, type: rule.type },
            project: { id: project.id, name: project.name, slug: project.slug },
            issue: {
              id: issue.id,
              fingerprint: issue.fingerprint,
              title: issue.title,
              count: issue.count
            },
            triggeredAt: now.toISOString()
          };
          try {
            await this.prisma.webhookDelivery.create({
              data: {
                endpointId: endpoint.id,
                projectId: project.id,
                alertRuleId: rule.id,
                dedupeKey,
                payload: payload as Prisma.InputJsonValue
              }
            });
            await this.deliveriesQueue.add(
              "deliver",
              { deliveryKey: dedupeKey },
              { jobId: deliveryJobId(dedupeKey) }
            );
          } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
              continue; // already delivered/queued for this trigger
            }
            throw error;
          }
        }
      }
    } catch (error) {
      // Alert evaluation must never break ingestion; log for observability.
      this.logger.error(`Alert evaluation failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  private withinCooldown(rule: AlertRule): boolean {
    if (!rule.lastTriggeredAt) return false;
    return Date.now() - rule.lastTriggeredAt.getTime() < rule.cooldownMinutes * 60_000;
  }

  private async matches(
    projectId: string,
    rule: AlertRule,
    issue: { id: string; fingerprint: string; title: string; count: number },
    issueCreated: boolean,
    occurredAt: Date
  ): Promise<boolean> {
    const config = rule.config as AlertRuleConfig;
    switch (rule.type) {
      case "NEW_ISSUE":
        return issueCreated;
      case "NEW_ISSUE_MATCHING":
        if (!issueCreated) return false;
        if (config.fingerprint && config.fingerprint !== issue.fingerprint) return false;
        if (config.titleContains && !issue.title.toLowerCase().includes(config.titleContains.toLowerCase())) return false;
        return true;
      case "ISSUE_THRESHOLD":
        if (config.fingerprint && config.fingerprint !== issue.fingerprint) return false;
        return issue.count >= (config.threshold ?? 0);
      case "ERROR_RATE": {
        const since = new Date(occurredAt.getTime() - (config.windowMinutes ?? 60) * 60_000);
        const count = await this.prisma.errorEvent.count({
          where: { projectId, occurredAt: { gte: since, lte: occurredAt } }
        });
        return count >= (config.eventThreshold ?? Number.MAX_SAFE_INTEGER);
      }
      default:
        return false;
    }
  }
}
