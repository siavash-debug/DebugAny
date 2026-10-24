import { Module } from "@nestjs/common";
import { MiddlewareConsumer, NestModule } from "@nestjs/common";
import { CorrelationIdMiddleware } from "./common/correlation-id.middleware";
import { EventsModule } from "./events/events.module";
import { HealthController } from "./health.controller";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [PrismaModule, EventsModule],
  controllers: [HealthController]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes("*");
  }
}
