import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";

/** Minimal project reference attached to authenticated ingestion requests. */
export interface ProjectRef {
  id: string;
  name: string;
  slug: string;
}

declare module "express-serve-static-core" {
  interface Request {
    ingestionProject?: ProjectRef;
  }
}

export const INGESTION_KEY_HEADER = "x-debugany-key";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqualHex(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Authenticates ingestion requests with a per-project ingestion key. Keys are
 * rows in the IngestionKey table (hash at rest); revoked or rotated keys fail
 * immediately. Key hashes are compared in constant time; raw keys are never
 * logged or persisted.
 */
@Injectable()
export class IngestionKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers[INGESTION_KEY_HEADER];
    const apiKey = Array.isArray(header) ? header[0] : header;

    if (!apiKey || apiKey.length > 256) {
      throw new UnauthorizedException("A valid x-debugany-key header is required.");
    }

    const apiKeyHash = sha256(apiKey);
    const key = await this.prisma.ingestionKey.findUnique({
      where: { keyHash: apiKeyHash },
      select: {
        id: true,
        keyHash: true,
        revokedAt: true,
        project: { select: { id: true, name: true, slug: true } }
      }
    });

    if (!key || key.revokedAt !== null || !safeEqualHex(key.keyHash, apiKeyHash)) {
      throw new UnauthorizedException("Invalid ingestion key.");
    }

    request.ingestionProject = key.project;
    // Best-effort usage tracking; must never block ingestion.
    this.prisma.ingestionKey
      .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return true;
  }
}
