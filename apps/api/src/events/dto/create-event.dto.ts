import { Type } from "class-transformer";
import {
  IsDateString,
  IsObject,
  IsOptional,
  IsString,
  MaxLength
} from "class-validator";

export class CreateEventDto {
  @IsString()
  @MaxLength(2000)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  errorType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12000)
  stackTrace?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  environment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  release?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}