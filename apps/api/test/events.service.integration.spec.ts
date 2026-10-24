import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../src/prisma/prisma.service";
import { EventsService } from "../src/events/events.service";
import { IssuesService } from "../src/issues/issues.service";
import type { CreateEventDto } from "../src/events/dto/create-event.dto";
import { ListIssuesQueryDto } from "../src/issues/dto/list-issues-query.dto";
import type { ProjectRef } from "../src/auth/ingestion-key.guard";

// Integration tests exercise real Postgres behavior. They run when a database
// is reachable via DATABASE_URL (locally or via the CI service container) and
// are skipped otherwise, so `npm test` never fails without infrastructure.
const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration("ingestion pipeline (integration)", () => {
  let prisma: PrismaService;
  let events: EventsService;
  let issues: IssuesService;
  let apiKey: string;
  let projectId: string;
  let project: ProjectRef;

  beforeAll(async () => {
    prisma = new PrismaService();
    events = new EventsService(prisma);
    issues = new IssuesService(prisma);
    apiKey = `dbg_test_${randomBytes(24).toString("hex")}`;
    const created = await prisma.project.create({
      data: {
        name: "CI integration project",
        slug: `ci-${randomBytes(8).toString("hex")}`,
        apiKeyHash: createHash("sha256").update(apiKey).digest("hex")
      }
    });
    projectId = created.id;
    project = { id: created.id, name: created.name, slug: created.slug };
  });

  afterAll(async () => {
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("persists an event and creates a durable issue", async () => {
    const result = await events.ingest(project, { message: "boom", errorType: "TypeError" });
    expect(result.accepted).toBe(true);
    const stored = await prisma.errorEvent.findUnique({ where: { id: result.event.id } });
    expect(stored?.projectId).toBe(projectId);
    expect(stored?.issueId).toBe(result.issue.id);
    const issue = await prisma.issue.findUniqueOrThrow({ where: { id: result.issue.id } });
    expect(issue.count).toBe(1);
    expect(issue.status).toBe("UNRESOLVED");
  });

  it("groups similar events into the same issue and advances aggregates", async () => {
    const first = await events.ingest(project, { message: "cache miss storm", errorType: "CacheError" });
    const second = await events.ingest(project, { message: "cache miss storm", errorType: "CacheError" });
    expect(second.issue.id).toBe(first.issue.id);
    const issue = await prisma.issue.findUniqueOrThrow({ where: { id: first.issue.id } });
    expect(issue.count).toBe(2);
  });

  it("separates issues with different fingerprints", async () => {
    await events.ingest(project, { message: "disk full", errorType: "IOError" });
    const listing = await issues.list(project, { limit: 100, offset: 0 });
    const titles = listing.issues.map((issue) => issue.title);
    expect(titles).toContain("cache miss storm");
    expect(titles).toContain("disk full");
    expect(listing.total).toBeGreaterThanOrEqual(2);
  });

  it("redacts sensitive metadata before persisting", async () => {
    const result = await events.ingest(project, {
      message: "leaky event",
      metadata: { password: "hunter2", safe: "value" }
    } as CreateEventDto);
    const stored = await prisma.errorEvent.findUniqueOrThrow({ where: { id: result.event.id } });
    expect(stored.metadata).toEqual({ password: "[redacted]", safe: "value" });
  });

  it("rejects oversized metadata with a 400-class error", async () => {
    await expect(events.ingest(project, {
      message: "big meta",
      metadata: { blob: "x".repeat(20_000) }
    } as CreateEventDto)).rejects.toMatchObject({ status: 400 });
  });

  it("reopens a resolved issue when the same error recurs", async () => {
    const { issue } = await events.ingest(project, { message: "flaky worker", errorType: "WorkerError" });
    await issues.updateStatus(project, issue.id, "RESOLVED");
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).status).toBe("RESOLVED");

    await events.ingest(project, { message: "flaky worker", errorType: "WorkerError" });
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).status).toBe("UNRESOLVED");
  });

  it("supports status transitions that persist", async () => {
    const { issue } = await events.ingest(project, { message: "noisy warning", errorType: "Warning" });
    const updated = await issues.updateStatus(project, issue.id, "IGNORED");
    expect(updated.status).toBe("IGNORED");
  });

  it("filters and paginates the issue list", async () => {
    const unresolved = await issues.list(project, { limit: 1, offset: 0 });
    expect(unresolved.issues).toHaveLength(1);
    expect(unresolved.total).toBeGreaterThan(1);

    const ignored = await issues.list(project, { status: "IGNORED", limit: 100, offset: 0 });
    expect(ignored.issues.length).toBeGreaterThanOrEqual(1);
    expect(ignored.issues.every((issue) => issue.status === "IGNORED")).toBe(true);

    const search = await issues.list(project, { search: "CACHE", limit: 100, offset: 0 });
    expect(search.issues.map((issue) => issue.title)).toContain("cache miss storm");

    const window = await issues.list(project, { since: new Date(Date.now() + 60_000).toISOString(), limit: 100, offset: 0 });
    expect(window.issues).toHaveLength(0);
  });

  it("returns issue detail with its grouped events", async () => {
    const { issue } = await events.ingest(project, { message: "detail probe", errorType: "DetailError" });
    const detail = await issues.getWithEvents(project, issue.id, 25, 0);
    expect(detail.issue.id).toBe(issue.id);
    expect(detail.issue.stackTrace).toBeNull();
    expect(detail.totalEvents).toBe(1);
    expect(detail.events).toHaveLength(1);
    expect(detail.events[0].message).toBe("detail probe");
  });

  it("never returns another project's issue", async () => {
    const { issue } = await events.ingest(project, { message: "isolation probe", errorType: "IsoError" });
    const other: ProjectRef = { id: "nope", name: "Other", slug: "other" };
    await expect(issues.getWithEvents(other, issue.id, 25, 0)).rejects.toMatchObject({ status: 404 });
    await expect(issues.updateStatus(other, issue.id, "RESOLVED")).rejects.toMatchObject({ status: 404 });
  });
});
