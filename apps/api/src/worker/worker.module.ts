import { Module } from "@nestjs/common";
import { AlertsModule } from "../alerts/alerts.module";
import { EventsModule } from "../events/events.module";
import { QueueModule } from "../queue/queue.module";
import { WebhooksModule } from "../webhooks/webhooks.module";
import { WorkerController } from "./worker.controller";
import { WorkerService } from "./worker.service";

@Module({
  imports: [QueueModule, EventsModule, AlertsModule, WebhooksModule],
  controllers: [WorkerController],
  providers: [WorkerService]
})
export class WorkerModule {}
