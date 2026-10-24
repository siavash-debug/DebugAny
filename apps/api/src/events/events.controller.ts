import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { IngestionKeyGuard } from "../auth/ingestion-key.guard";
import { IngestionProject } from "../auth/ingestion-project.decorator";
import type { ProjectRef } from "../auth/ingestion-key.guard";
import { CreateEventDto } from "./dto/create-event.dto";
import { EventsService } from "./events.service";

@UseGuards(IngestionKeyGuard)
@Controller("events")
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  ingest(@IngestionProject() project: ProjectRef, @Body() dto: CreateEventDto) {
    return this.eventsService.ingest(project, dto);
  }
}
