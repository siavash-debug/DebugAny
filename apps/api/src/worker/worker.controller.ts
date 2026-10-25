import { Controller, Get } from "@nestjs/common";
import { WorkerService } from "./worker.service";

/** Worker process health: consumed/failed counters and liveness. */
@Controller("worker")
export class WorkerController {
  constructor(private readonly worker: WorkerService) {}

  @Get("health")
  health() {
    return { status: "ok", service: "debugany-worker", ...this.worker.getHealth(), timestamp: new Date().toISOString() };
  }
}
