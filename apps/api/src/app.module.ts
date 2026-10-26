import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ThrottlerModule, type ThrottlerStorage } from "@nestjs/throttler";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { CorrelationIdMiddleware } from "./common/correlation-id.middleware";
import { env, warnMissingEncryptionKey } from "./config/env";
import { EventsModule } from "./events/events.module";
import { HealthController } from "./health.controller";
import { IssuesModule } from "./issues/issues.module";
import { MetricsModule } from "./metrics/metrics.module";
import { RateLimitModule, RATE_LIMIT_STORAGE } from "./rate-limit/rate-limit.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ProjectsModule } from "./projects/projects.module";
import { QueueModule } from "./queue/queue.module";
import { AlertsModule } from "./alerts/alerts.module";
import { WebhooksModule } from "./webhooks/webhooks.module";
import { WorkerModule } from "./worker/worker.module";

warnMissingEncryptionKey();

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    AuthModule,
    ProjectsModule,
    EventsModule,
    IssuesModule,
    MetricsModule,
    QueueModule,
    AlertsModule,
    WebhooksModule,
    // Only the worker process (DEBUGANY_WORKER=true) consumes queues.
    ...(env.workerEnabled ? [WorkerModule] : []),
    RateLimitModule,
    ThrottlerModule.forRootAsync({
      inject: [RATE_LIMIT_STORAGE],
      useFactory: (storage?: ThrottlerStorage) => ({
        throttlers: [{ ttl: 60_000, limit: 120 }],
        // When undefined (memory mode), the throttler falls back to its
        // built-in per-process storage automatically.
        storage
      })
    })
  ],
  controllers: [HealthController]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes("*");
  }
}
