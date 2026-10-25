import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/prisma/prisma.service";
import { IngestionCoreService } from "../src/events/ingestion-core.service";
import { IssuesService } from "../src/issues/issues.service";
import { AuditService } from "../src/audit/audit.service";
import { createUser, createProjectOwnedBy, createIngestionKey, type TestUser } from "./helpers";
import { IngestionKeyGuard } from "../src/auth/ingestion-key.guard";
import type { CreateEventDto } from "../src/events/dto/create-event.dto";

// Ingestion pipeline integration tests: event persistence, fingerprint
// grouping, redaction, and durable issue aggregates against real Postgres.
const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

// Queue stub: tests run in sync ingestion mode, so the queue is never used.


describeIntegration("ingestion pipeline (integration)", () => {
  let prisma: PrismaService;
  let core: IngestionCoreService;
  let issues: IssuesService;
  let guard: IngestionKeyGuard;
  let owner: TestUser;
  let project: { id: string; name: string; slug: string };
  let apiKey: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    const audit = new AuditService(prisma);
    core = new IngestionCoreService(prisma);
    issues = new IssuesService(prisma, audit);
    guard = new IngestionKeyGuard(prisma);
    owner = await createUser(prisma, "ingest-owner");
    project = await createProjectOwnedBy(prisma, owner, "ingest");
    apiKey = await createIngestionKey(prisma, project.id);
  });

  afterAll(async () => {
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: owner.dbId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  let ingestCounter = 0;
  function ingest(projectRef: { id: string; name: string; slug: string }, input: Record<string, unknown>) {
    ingestCounter += 1;
    return core.processEvent(projectRef, {
      message: String(input.message),
      errorType: input.errorType as string | undefined,
      stackTrace: input.stackTrace as string | undefined,
      environment: input.environment as string | undefined,
      release: input.release as string | undefined,
      occurredAt: typeof input.occurredAt === "string" ? input.occurredAt : new Date().toISOString(),
      metadata: input.metadata as Record<string, unknown> | undefined
    }, `test-job-${Date.now()}-${ingestCounter}-${Math.random().toString(36).slice(2, 8)}`);
  }

  function guardFor(headers: Record<string, string>) {
    return {
      switchToHttp: () => ({ getRequest: () => ({ headers }) })
    } as never;
  }

  it("authenticates a valid ingestion key and resolves the project", async () => {
    const request = { headers: { "x-debugany-key": apiKey } };
    await guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as never);
    expect((request as { ingestionProject?: { id: string } }).ingestionProject?.id).toBe(project.id);
    await expect(guard.canActivate(guardFor({ "x-debugany-key": "dbg_live_invalid" }))).rejects.toMatchObject({ status: 401 });
  });

  it("persists an event and creates a durable issue", async () => {
    const result = await ingest(project, { message: "boom", errorType: "TypeError" });
        const stored = await prisma.errorEvent.findUnique({ where: { id: result.event.id } });
    expect(stored?.projectId).toBe(project.id);
    expect(stored?.issueId).toBe(result.issue.id);
    const issue = await prisma.issue.findUniqueOrThrow({ where: { id: result.issue.id } });
    expect(issue.count).toBe(1);
    expect(issue.status).toBe("UNRESOLVED");
  });

  it("groups similar events into the same issue and advances aggregates", async () => {
    const first = await ingest(project, { message: "cache miss storm", errorType: "CacheError" });
    const second = await ingest(project, { message: "cache miss storm", errorType: "CacheError" });
    expect(second.issue!.id).toBe(first.issue!.id);
    const issue = await prisma.issue.findUniqueOrThrow({ where: { id: first.issue.id } });
    expect(issue.count).toBe(2);
  });

  it("separates issues with different fingerprints", async () => {
    await ingest(project, { message: "disk full", errorType: "IOError" });
    const listing = await issues.list(project.id, { limit: 100, offset: 0 });
    const titles = listing.issues.map((issue) => issue.title);
    expect(titles).toContain("cache miss storm");
    expect(titles).toContain("disk full");
    expect(listing.total).toBeGreaterThanOrEqual(2);
  });

  it("redacts sensitive metadata before persisting", async () => {
    const result = await ingest(project, {
      message: "leaky event",
      metadata: { password: "hunter2", safe: "value" }
    } as CreateEventDto as unknown as Record<string, unknown>);
    const stored = await prisma.errorEvent.findUniqueOrThrow({ where: { id: result.event.id } });
    expect(stored.metadata).toEqual({ password: "[redacted]", safe: "value" });
  });

  it("rejects oversized metadata with a 400-class error", async () => {
    await expect(ingest(project, {
      message: "big meta",
      metadata: { blob: "x".repeat(20_000) }
    })).rejects.toMatchObject({ status: 400 });
  });

  it("reopens a resolved issue when the same error recurs", async () => {
    const { issue } = await ingest(project, { message: "flaky worker", errorType: "WorkerError" });
    await issues.updateStatus(project.id, issue.id, "RESOLVED", owner.user.id);
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).status).toBe("RESOLVED");

    await ingest(project, { message: "flaky worker", errorType: "WorkerError" });
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).status).toBe("UNRESOLVED");
  });

  it("returns issue detail with its grouped events", async () => {
    const { issue } = await ingest(project, { message: "detail probe", errorType: "DetailError" });
    const detail = await issues.getWithEvents(project.id, issue.id, 25, 0);
    expect(detail.issue.id).toBe(issue.id);
    expect(detail.totalEvents).toBe(1);
    expect(detail.events[0].message).toBe("detail probe");
  });
});
