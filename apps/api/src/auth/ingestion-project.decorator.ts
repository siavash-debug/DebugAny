import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { ProjectRef } from "./ingestion-key.guard";

/** Resolves the project authenticated by the ingestion key guard. */
export const IngestionProject = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ProjectRef => {
    return context.switchToHttp().getRequest().ingestionProject;
  }
);
