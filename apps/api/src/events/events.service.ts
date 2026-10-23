import { createHash, timingSafeEqual } from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CreateEventDto } from "./dto/create-event.dto";
import { PrismaService } from "../prisma/prisma.service";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqualHex(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  private async findProjectForKey(apiKey: string | undefined) {
    if (!apiKey || apiKey.length > 256) {
      throw new UnauthorizedException("A valid x-debugany-key header is required.");
    }

    const apiKeyHash = sha256(apiKey);
    const project = await this.prisma.project.findUnique({
      where: { apiKeyHash },
      select: { id: true, apiKeyHash: true, name: true, slug: true }
    });

    if (!project || !safeEqualHex(project.apiKeyHash, apiKeyHash)) {
      throw new UnauthorizedException("Invalid ingestion key.");
    }
    return project;
  }

  async listIssues(apiKey: string | undefined) {
    const project = await this.findProjectForKey(apiKey);
    const totalEvents = await this.prisma.errorEvent.count({ where: { projectId: project.id } });
    const events = await this.prisma.errorEvent.findMany({
      where: { projectId: project.id }, orderBy: { occurredAt: "desc" }, take: 500,
      select: { id: true, message: true, errorType: true, stackTrace: true, environment: true, release: true, fingerprint: true, occurredAt: true, createdAt: true }
    });
    const grouped = new Map<string, { fingerprint: string; title: string; errorType: string; environment: string; release: string | null; stackTrace: string | null; count: number; firstSeen: Date; lastSeen: Date; latestEventId: string }>();
    for (const event of events) {
      const item = grouped.get(event.fingerprint);
      if (item) { item.count += 1; if (event.occurredAt < item.firstSeen) item.firstSeen = event.occurredAt; }
      else grouped.set(event.fingerprint, { fingerprint: event.fingerprint, title: event.message, errorType: event.errorType ?? "Error", environment: event.environment, release: event.release, stackTrace: event.stackTrace, count: 1, firstSeen: event.occurredAt, lastSeen: event.occurredAt, latestEventId: event.id });
    }
    return { project: { id: project.id, name: project.name, slug: project.slug }, totalEvents, issues: [...grouped.values()].sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime()) };
  }

  async ingest(apiKey: string | undefined, dto: CreateEventDto) {
    if (!apiKey || apiKey.length > 256) {
      throw new UnauthorizedException("A valid x-debugany-key header is required.");
    }

    const apiKeyHash = sha256(apiKey);
    const project = await this.prisma.project.findUnique({
      where: { apiKeyHash },
      select: { id: true, apiKeyHash: true }
    });

    if (!project || !safeEqualHex(project.apiKeyHash ?? "", apiKeyHash)) {
      throw new UnauthorizedException("Invalid ingestion key.");
    }

    const normalizedMessage = dto.message.trim().replace(/\s+/g, " ");
    const fingerprint = sha256([
      dto.errorType?.trim() ?? "Error",
      normalizedMessage,
      (dto.stackTrace ?? "").split("\n").slice(0, 3).join("\n")
    ].join("|"));

    const event = await this.prisma.errorEvent.create({
      data: {
        projectId: project.id,
        message: normalizedMessage,
        errorType: dto.errorType,
        stackTrace: dto.stackTrace,
        environment: dto.environment ?? "production",
        release: dto.release,
        fingerprint,
        metadata: dto.metadata as Prisma.InputJsonValue | undefined,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date()
      },
      select: { id: true, fingerprint: true, occurredAt: true, createdAt: true }
    });

    return { accepted: true, event };
  }
}