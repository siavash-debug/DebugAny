import { Module } from "@nestjs/common";
import { EventsController } from "./events.controller";
import { EventsService } from "./events.service";
import { IngestionCoreService } from "./ingestion-core.service";

@Module({
  controllers: [EventsController],
  providers: [EventsService, IngestionCoreService],
  exports: [IngestionCoreService]
})
export class EventsModule {}
