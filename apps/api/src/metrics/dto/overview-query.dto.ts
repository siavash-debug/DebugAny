import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

export class OverviewQueryDto {
  /** Look-back window in hours, capped to keep bucket counts bounded. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  windowHours?: number = 24;
}
