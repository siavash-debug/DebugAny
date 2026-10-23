import { Module } from "@nestjs/common";
import { EventsModule } from "./events/events.module";
import { HealthController } from "./health.controller";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [PrismaModule, EventsModule],
  controllers: [HealthController]
})
export class AppModule {}