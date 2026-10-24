import { Type } from "class-transformer";
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export const ISSUE_STATUSES = ["UNRESOLVED", "RESOLVED", "IGNORED"] as const;
export type IssueStatusFilter = (typeof ISSUE_STATUSES)[number];

export class ListIssuesQueryDto {
  @IsOptional()
  @IsIn(ISSUE_STATUSES)
  status?: IssueStatusFilter;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  environment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;

  @IsOptional()
  @IsISO8601()
  since?: string;

  @IsOptional()
  @IsISO8601()
  until?: string;
}
