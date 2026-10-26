import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import type { ThrottlerStorage } from "@nestjs/throttler";
import type Redis from "ioredis";

/** Mirrors @nestjs/throttler's ThrottlerStorageRecord (not re-exported by the package). */
interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Redis-backed throttler storage so auth rate limits are shared across all
 * API instances instead of per-process memory.
 *
 * Design notes:
 * - The window counter is an atomic INCR with a PEXPIRE only on the first hit
 *   (single Lua script), so a sliding count survives concurrent requests from
 *   multiple instances without TTL thrashing.
 * - Fail closed: when Redis cannot be reached at increment time, auth requests
 *   fail with 503 instead of silently proceeding without a shared limit. A
 *   fail-open switch here would turn every Redis outage into an unlimited
 *   brute-force window, so this is intentional; see docs/operations/runbook.
 */
@Injectable()
export class RedisRateLimitStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisRateLimitStorage.name);

  private static readonly INCREMENT_SCRIPT = `
local counter = redis.call('INCR', KEYS[1])
if counter == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local pttl = redis.call('PTTL', KEYS[1])
if pttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  pttl = tonumber(ARGV[1])
end
return {counter, pttl}
`;

  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    _limit: number,
    _blockDuration: number,
    _throttlerName: string
  ): Promise<ThrottlerStorageRecord> {
    const windowMs = Math.max(0, Math.ceil(ttl));
    try {
      const result = (await this.redis.eval(
        RedisRateLimitStorage.INCREMENT_SCRIPT,
        1,
        key,
        String(windowMs)
      )) as [number, number];
      const [totalHits, pttl] = result;
      return {
        totalHits: Number(totalHits),
        timeToExpire: Math.ceil(Number(pttl) / 1000),
        // Window-counting only; blocking (blockDuration) is not used by the
        // current throttler configuration.
        isBlocked: false,
        timeToBlockExpire: 0
      };
    } catch (error) {
      this.logger.error(`Redis rate-limit storage unavailable: ${error instanceof Error ? error.message : error}`);
      throw new ServiceUnavailableException("Rate limit storage is temporarily unavailable.");
    }
  }
}
