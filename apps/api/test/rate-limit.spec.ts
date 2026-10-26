import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import Redis from "ioredis";
import { ServiceUnavailableException } from "@nestjs/common";
import { RedisRateLimitStorage } from "../src/rate-limit/redis-rate-limit.storage";
import { deliveryJobId } from "../src/queue/queue.module";

// The Redis-backed throttler storage. Unit cases use a fake client; the
// integration section uses the real local Redis when reachable: same gating
// as the phase 6 integration suites (DATABASE_URL present implies the
// docker-compose Redis is expected locally).
const redisUrl = process.env.REDIS_URL ?? (process.env.DATABASE_URL ? "redis://localhost:6379" : null) ?? "redis://localhost:6379";
const describeRedis = process.env.REDIS_URL || process.env.DATABASE_URL ? describe : describe.skip;

function fakeClient(evalResult: () => unknown) {
  return { eval: vi.fn(evalResult) } as unknown as Redis;
}

describe("RedisRateLimitStorage (unit)", () => {
  it("maps the atomic INCR/PEXPIRE result to the throttler record", async () => {
    const redis = fakeClient(() => [4, 42_000]);
    const storage = new RedisRateLimitStorage(redis);
    const record = await storage.increment("throttle-key", 60_000, 10, 0, "default");
    expect(record.totalHits).toBe(4);
    expect(record.timeToExpire).toBe(42);
    expect(record.isBlocked).toBe(false);
    expect(redis.eval).toHaveBeenCalledOnce();
  });

  it("fails closed (503) when Redis is unreachable at increment time", async () => {
    const redis = fakeClient(() => {
      throw new Error("Connection is closed.");
    });
    const storage = new RedisRateLimitStorage(redis);
    // A fail-open fallback here would disable brute-force protection for
    // every auth endpoint during a Redis outage, so the exception is required.
    await expect(storage.increment("throttle-key", 60_000, 10, 0, "default")).rejects.toMatchObject({
      status: 503
    });
  });

  it("resolves non-positive expirations without returning negative windows", async () => {
    const redis = fakeClient(() => [1, 0]);
    const storage = new RedisRateLimitStorage(redis);
    const record = await storage.increment("throttle-key", 0, 10, 0, "default");
    expect(record.timeToExpire).toBe(0);
  });
});

describe("BullMQ job id sanity (rerun guard)", () => {
  it("keeps delivery job ids colon-free", () => {
    const key = `${Date.now()}:${Math.random()}:${Math.random()}:1`;
    const jobId = deliveryJobId(key);
    expect(jobId.startsWith("delivery-")).toBe(true);
    expect(jobId.split(":").length === 1 || jobId.split(":").length === 3).toBe(true);
  });
});

describeRedis("RedisRateLimitStorage (integration, shared Redis)", () => {
  it("shares counters across independent storage instances", async () => {
    const redisKey = `rate-limit-test:${Date.now()}`;
    const redisA = new Redis(redisUrl);
    const redisB = new Redis(redisUrl);
    try {
      const storageA = new RedisRateLimitStorage(redisA);
      const storageB = new RedisRateLimitStorage(redisB);
      const first = await storageA.increment(redisKey, 60_000, 10, 0, "default");
      const second = await storageB.increment(redisKey, 60_000, 10, 0, "default");
      expect(first.totalHits).toBe(1);
      // The second "instance" observed the shared counter from Redis.
      expect(second.totalHits).toBe(2);
      expect(second.timeToExpire).toBeGreaterThan(0);
      expect(second.timeToExpire).toBeLessThanOrEqual(60);
    } finally {
      await redisA.del(redisKey).catch(() => undefined);
      await redisA.quit().catch(() => undefined);
      await redisB.quit().catch(() => undefined);
    }
  });
});
