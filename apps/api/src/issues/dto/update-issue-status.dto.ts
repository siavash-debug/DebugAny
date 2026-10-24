import { IsIn } from "class-validator";
import { ISSUE_STATUSES, IssueStatusFilter } from "./list-issues-query.dto";

export class UpdateIssueStatusDto {
  @IsIn(ISSUE_STATUSES)
  status!: IssueStatusFilter;
}
