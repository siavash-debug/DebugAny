import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { CorrelationIdMiddleware } from "./common/correlation-id.middleware";
import { EventsModule } from "./events/events.module";
import { HealthController } from "./health.controller";
import { IssuesModule } from "./issues/issues.module";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [PrismaModule, EventsModule, IssuesModule],
  controllers: [HealthController]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes("*");
  }
}
