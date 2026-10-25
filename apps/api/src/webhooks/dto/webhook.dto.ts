import { IsBoolean, IsOptional, IsString, MaxLength, MinLength, IsUrl } from "class-validator";

export class CreateWebhookDto {
  @IsUrl({ protocols: ["http", "https"], require_valid_protocol: true })
  @MaxLength(2000)
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}

export class UpdateWebhookDto {
  @IsOptional()
  @IsUrl({ protocols: ["http", "https"], require_valid_protocol: true })
  @MaxLength(2000)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
