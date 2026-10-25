import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { CorrelationIdMiddleware } from "./common/correlation-id.middleware";
import { EventsModule } from "./events/events.module";
import { HealthController } from "./health.controller";
import { IssuesModule } from "./issues/issues.module";
import { MetricsModule } from "./metrics/metrics.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ProjectsModule } from "./projects/projects.module";

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    AuthModule,
    ProjectsModule,
    EventsModule,
    IssuesModule,
    MetricsModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])
  ],
  controllers: [HealthController]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes("*");
  }
}
