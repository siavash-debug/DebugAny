import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ProjectsModule } from "../projects/projects.module";
import { MetricsController } from "./metrics.controller";
import { MetricsService } from "./metrics.service";

@Module({
  imports: [AuthModule, ProjectsModule],
  controllers: [MetricsController],
  providers: [MetricsService]
})
export class MetricsModule {}
