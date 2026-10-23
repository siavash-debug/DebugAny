import { createHash, timingSafeEqual } from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
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

  async ingest(apiKey: string | undefined, dto: CreateEventDto) {
    if (!apiKey || apiKey.length > 256) {
      throw new UnauthorizedException("A valid x-debugany-key header is required.");
    }

    const apiKeyHash = sha256(apiKey);
    const project = await this.prisma.project.findUnique({
      where: { apiKeyHash },
      select: { id: true }
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
        metadata: dto.metadata as object | undefined,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date()
      },
      select: { id: true, fingerprint: true, occurredAt: true, createdAt: true }
    });

    return { accepted: true, event };
  }
}