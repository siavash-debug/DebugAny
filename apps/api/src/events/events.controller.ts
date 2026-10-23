import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { CreateEventDto } from "./dto/create-event.dto";
import { EventsService } from "./events.service";

@Controller("events")
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async ingest(
    @Headers("x-debugany-key") apiKey: string | undefined,
    @Body() dto: CreateEventDto
  ) {
    return this.eventsService.ingest(apiKey, dto);
  }
}