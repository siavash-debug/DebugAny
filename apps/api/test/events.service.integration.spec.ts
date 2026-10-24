import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../src/prisma/prisma.service";
import { EventsService } from "../src/events/events.service";
import type { CreateEventDto } from "../src/events/dto/create-event.dto";

// Integration tests exercise real Postgres behavior. They run when a database
// is reachable via DATABASE_URL (locally or via the CI service container) and
// are skipped otherwise, so `npm test` never fails without infrastructure.
const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration("EventsService (integration)", () => {
  let prisma: PrismaService;
  let events: EventsService;
  let apiKey: string;
  let projectId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    events = new EventsService(prisma);
    apiKey = `dbg_test_${randomBytes(24).toString("hex")}`;
    const project = await prisma.project.create({
      data: {
        name: "CI integration project",
        slug: `ci-${randomBytes(8).toString("hex")}`,
        apiKeyHash: createHash("sha256").update(apiKey).digest("hex")
      }
    });
    projectId = project.id;
  });

  afterAll(async () => {
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("rejects unknown ingestion keys", async () => {
    await expect(events.ingest("dbg_test_invalid", { message: "x" } as CreateEventDto))
      .rejects.toMatchObject({ status: 401 });
  });

  it("persists an event and returns it", async () => {
    const result = await events.ingest(apiKey, { message: "boom", errorType: "TypeError" });
    expect(result.accepted).toBe(true);
    const stored = await prisma.errorEvent.findUnique({ where: { id: result.event.id } });
    expect(stored?.projectId).toBe(projectId);
    expect(stored?.errorType).toBe("TypeError");
  });

  it("assigns the same fingerprint to similar events", async () => {
    const first = await events.ingest(apiKey, { message: "cache miss storm", errorType: "CacheError" });
    const second = await events.ingest(apiKey, { message: "cache miss storm", errorType: "CacheError" });
    expect(first.event.fingerprint).toBe(second.event.fingerprint);
  });

  it("redacts sensitive metadata before persisting", async () => {
    const result = await events.ingest(apiKey, {
      message: "leaky event",
      metadata: { password: "hunter2", safe: "value" }
    } as CreateEventDto);
    const stored = await prisma.errorEvent.findUniqueOrThrow({ where: { id: result.event.id } });
    expect(stored.metadata).toEqual({ password: "[redacted]", safe: "value" });
  });

  it("rejects oversized metadata with a 400-class error", async () => {
    await expect(events.ingest(apiKey, {
      message: "big meta",
      metadata: { blob: "x".repeat(20_000) }
    } as CreateEventDto)).rejects.toMatchObject({ status: 400 });
  });

  it("groups recent events into issues ordered by last seen", async () => {
    const listing = await events.listIssues(apiKey);
    expect(listing.project.id).toBe(projectId);
    expect(listing.totalEvents).toBeGreaterThanOrEqual(3);
    const cacheIssue = listing.issues.find((issue) => issue.title === "cache miss storm");
    expect(cacheIssue).toBeDefined();
    expect(cacheIssue?.count).toBe(2);
  });
});
