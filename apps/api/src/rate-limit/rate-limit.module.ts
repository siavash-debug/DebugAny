import { Global, Logger, Module, type OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { env } from "../config/env";
import { RedisRateLimitStorage } from "./redis-rate-limit.storage";

export const RATE_LIMIT_REDIS = "RATE_LIMIT_REDIS";
export const RATE_LIMIT_STORAGE = "RATE_LIMIT_STORAGE";

/**
 * Optional Redis connection for the shared rate limiter. Created with
 * lazyConnect and no offline queue so that a Redis outage surfaces
 * immediately as a fail-closed auth error (see redis-rate-limit.storage.ts)
 * instead of silently hanging requests.
 */
class RateLimitRedis implements OnModuleDestroy {
  private readonly logger = new Logger("RateLimitRedis");
  readonly client?: Redis;

  constructor() {
    if (env.rateLimitStorage !== "redis") return;
    this.client = new Redis(env.redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => (times > 10 ? null : Math.min(500 * times, 5_000))
    });
    this.client
      .connect()
      .then(() => this.logger.log("Shared rate limiter connected to Redis."))
      .catch((error) => this.logger.error(`Shared rate limiter failed to connect: ${error?.message ?? error}`));
  }

  onModuleDestroy(): void {
    this.client?.disconnect();
  }
}

/**
 * Provides the optional shared rate limiter. RATE_LIMIT_STORAGE is undefined
 * (throttler's per-process memory storage, single-instance behavior) unless
 * DEBUGANY_RATE_LIMIT_STORAGE=redis is configured.
 */
@Global()
@Module({
  providers: [
    RateLimitRedis,
    {
      provide: RATE_LIMIT_STORAGE,
      useFactory: (configured?: RateLimitRedis) =>
        configured?.client ? new RedisRateLimitStorage(configured.client) : undefined,
      inject: [RateLimitRedis]
    }
  ],
  exports: [RATE_LIMIT_STORAGE]
})
export class RateLimitModule {}
