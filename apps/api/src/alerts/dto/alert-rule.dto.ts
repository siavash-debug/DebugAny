import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength
} from "class-validator";

export const ALERT_RULE_TYPES = ["NEW_ISSUE", "NEW_ISSUE_MATCHING", "ISSUE_THRESHOLD", "ERROR_RATE"] as const;
export type AlertRuleTypeValue = (typeof ALERT_RULE_TYPES)[number];

export interface AlertRuleConfig {
  /** NEW_ISSUE_MATCHING: case-insensitive substring on the issue title. */
  titleContains?: string;
  /** NEW_ISSUE_MATCHING / ISSUE_THRESHOLD: restrict to one fingerprint. */
  fingerprint?: string;
  /** ISSUE_THRESHOLD: occurrences before triggering (inclusive). */
  threshold?: number;
  /** ERROR_RATE: event count in the window before triggering (inclusive). */
  eventThreshold?: number;
  /** ERROR_RATE: window length in minutes (5–1440). */
  windowMinutes?: number;
}

export class CreateAlertRuleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsIn(ALERT_RULE_TYPES)
  type!: AlertRuleTypeValue;

  @IsObject()
  config!: AlertRuleConfig;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_080)
  cooldownMinutes?: number;

  @IsOptional()
  @IsString()
  webhookId?: string;
}

export class UpdateAlertRuleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsObject()
  config?: AlertRuleConfig;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_080)
  cooldownMinutes?: number;

  @IsOptional()
  @IsString()
  webhookId?: string;
}

/** Validates type-specific rule config; throws on invalid combinations. */
export function validateRuleConfig(type: AlertRuleTypeValue, config: AlertRuleConfig): AlertRuleConfig {
  const errors: string[] = [];
  if (type === "NEW_ISSUE_MATCHING") {
    if (!config.titleContains && !config.fingerprint) {
      errors.push("config.titleContains or config.fingerprint is required");
    }
    if (config.titleContains && config.titleContains.length > 200) {
      errors.push("config.titleContains must be at most 200 characters");
    }
  }
  if (type === "ISSUE_THRESHOLD") {
    if (!Number.isInteger(config.threshold) || (config.threshold as number) < 2 || (config.threshold as number) > 100_000) {
      errors.push("config.threshold must be an integer between 2 and 100000");
    }
    if (config.fingerprint !== undefined && typeof config.fingerprint !== "string") {
      errors.push("config.fingerprint must be a string");
    }
  }
  if (type === "ERROR_RATE") {
    if (!Number.isInteger(config.eventThreshold) || (config.eventThreshold as number) < 2 || (config.eventThreshold as number) > 1_000_000) {
      errors.push("config.eventThreshold must be an integer between 2 and 1000000");
    }
    if (!Number.isInteger(config.windowMinutes) || (config.windowMinutes as number) < 5 || (config.windowMinutes as number) > 1440) {
      errors.push("config.windowMinutes must be an integer between 5 and 1440");
    }
  }
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
  return config;
}
