import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export interface AccessibleProject {
  id: string;
  name: string;
  slug: string;
  role: string;
}

/** Resolves the project checked by the project access guard. */
export const CurrentProject = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AccessibleProject => {
    return context.switchToHttp().getRequest().project;
  }
);
