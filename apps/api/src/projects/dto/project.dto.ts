import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class CreateProjectDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/, {
    message: "slug must be 3-64 chars of lowercase letters, digits and hyphens"
  })
  slug!: string;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;
}

export class CreateKeyDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}

export const KEY_ACTIONS = ["REVOKE", "ROTATE"] as const;

export class RotateKeyDto {
  @IsIn(["ROTATE"])
  action!: "ROTATE";
}
