import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "./prisma/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: the process is up. Does not depend on backing services. */
  @Get()
  getHealth() {
    return { status: "ok", service: "debugany-api", timestamp: new Date().toISOString() };
  }

  /** Readiness: the process can serve traffic, i.e. the database answers queries. */
  @Get("ready")
  async getReadiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "ready", checks: { database: "up" }, timestamp: new Date().toISOString() };
    } catch (error) {
      throw new ServiceUnavailableException({
        status: "degraded",
        checks: { database: "down" },
        detail: error instanceof Error ? error.message : "database check failed"
      });
    }
  }
}
