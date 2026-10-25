import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ProjectsModule } from "../projects/projects.module";
import { IssuesController } from "./issues.controller";
import { IssuesService } from "./issues.service";

@Module({
  imports: [AuthModule, ProjectsModule],
  controllers: [IssuesController],
  providers: [IssuesService]
})
export class IssuesModule {}
