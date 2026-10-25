import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuthService } from "../src/auth/auth.service";
import { ProjectsService } from "../src/projects/projects.service";
import { AuditService } from "../src/audit/audit.service";
import { IssuesService } from "../src/issues/issues.service";
import { IngestionCoreService } from "../src/events/ingestion-core.service";
import { IngestionKeyGuard } from "../src/auth/ingestion-key.guard";
import { createUser, createProjectOwnedBy, type TestUser } from "./helpers";
import type { ProjectRef } from "../src/auth/ingestion-key.guard";

// Phase 5 integration suite: authentication, project permissions, key
// lifecycle, tenant isolation, and audit records against real Postgres.
const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

// Queue stub: tests run in sync ingestion mode, so the queue is never used.


function guardRequest(projectRef: ProjectRef | undefined, headers: Record<string, string | string[]>) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers, ingestionProject: projectRef })
    })
  } as never;
}

describeIntegration("phase 5: auth, projects, keys, isolation (integration)", () => {
  let prisma: PrismaService;
  let auth: AuthService;
  let projects: ProjectsService;
  let issues: IssuesService;
  let core: IngestionCoreService;
  let guard: IngestionKeyGuard;
  let alice: TestUser;
  let bob: TestUser;
  let aliceProject: { id: string; name: string; slug: string };
  const cleanup: Array<Promise<unknown>> = [];

  beforeAll(() => {
    prisma = new PrismaService();
    const audit = new AuditService(prisma);
    auth = new AuthService(prisma);
    projects = new ProjectsService(prisma, audit);
    issues = new IssuesService(prisma, audit);
    core = new IngestionCoreService(prisma);
    guard = new IngestionKeyGuard(prisma);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: "@test.debugany.local" } } });
    await prisma.$disconnect();
  });

  it("registers a user, logs in, and resolves the session", async () => {
    const registered = await auth.register({
      email: `reg-${Math.random().toString(36).slice(2)}@test.debugany.local`,
      password: "correct-horse-battery",
      name: "Registrar"
    });
    expect(registered.token).toBeDefined();
    expect(registered.user.email).toContain("@test.debugany.local");
    cleanup.push(prisma.user.delete({ where: { id: registered.user.id } }));

    const me = await auth.resolveSession(registered.token);
    expect(me?.id).toBe(registered.user.id);

    const login = await auth.login({
      email: registered.user.email,
      password: "correct-horse-battery"
    });
    expect(login.user.id).toBe(registered.user.id);
  });

  it("rejects duplicate registration, wrong password, and garbage sessions", async () => {
    const email = `dup-${Math.random().toString(36).slice(2)}@test.debugany.local`;
    const first = await auth.register({ email, password: "correct-horse-battery", name: "Dup" });
    cleanup.push(prisma.user.delete({ where: { id: first.user.id } }));

    await expect(
      auth.register({ email: email.toUpperCase(), password: "correct-horse-battery", name: "Dup2" })
    ).rejects.toMatchObject({ status: 409 });

    await expect(
      auth.login({ email, password: "wrong-password-999" })
    ).rejects.toMatchObject({ status: 401 });

    await expect(
      auth.login({ email: "ghost@test.debugany.local", password: "wrong-password-999" })
    ).rejects.toMatchObject({ status: 401 });

    expect(await auth.resolveSession("not-a-real-token")).toBeNull();
    expect(await auth.resolveSession(undefined)).toBeNull();
  });

  it("invalidates the session after logout", async () => {
    const session = await auth.register({
      email: `out-${Math.random().toString(36).slice(2)}@test.debugany.local`,
      password: "correct-horse-battery",
      name: "Out"
    });
    expect(await auth.resolveSession(session.token)).not.toBeNull();
    await auth.logout(session.token);
    expect(await auth.resolveSession(session.token)).toBeNull();
  });

  it("creates projects with the creator as OWNER and lists only their projects", async () => {
    alice = await createUser(prisma, "alice");
    bob = await createUser(prisma, "bob");
    aliceProject = await projects.create(alice.user, {
      name: "Alice Console",
      slug: `alice-${Math.random().toString(36).slice(2, 10)}`
    });

    const aliceList = await projects.listWithRoles(alice.user.id);
    expect(aliceList.find((p) => p.id === aliceProject.id)?.role).toBe("OWNER");
    expect((await projects.listWithRoles(bob.user.id)).find((p) => p.id === aliceProject.id)).toBeUndefined();

    await expect(
      projects.create(alice.user, { name: "Other", slug: aliceProject.slug })
    ).rejects.toMatchObject({ status: 409 });
  });

  it("denies non-members any access to another user's project (IDOR)", async () => {
    expect(await projects.getForMember(aliceProject.id, bob.user.id)).toBeNull();
    await expect(projects.requireMember(aliceProject.id, bob.user.id)).rejects.toMatchObject({ status: 404 });
    await expect(projects.update(bob.user, aliceProject.id, { name: "Hacked" })).rejects.toMatchObject({ status: 404 });
    await expect(projects.delete(bob.user, aliceProject.id)).rejects.toMatchObject({ status: 404 });
    await expect(projects.listKeys(aliceProject.id, bob.user.id)).rejects.toMatchObject({ status: 404 });
    await expect(
      projects.createKey(bob.user, aliceProject.id, {})
    ).rejects.toMatchObject({ status: 404 });
  });

  it("restricts owner-only actions to the OWNER role", async () => {
    const key = await projects.createKey(alice.user, aliceProject.id, { name: "ci" });
    await projects.revokeKey(alice.user, aliceProject.id, key.id);

    // Make bob a MEMBER of alice's project: can read and manage keys, not rotate/delete.
    await prisma.projectMember.create({
      data: { projectId: aliceProject.id, userId: bob.dbId, role: "MEMBER" }
    });
    expect((await projects.getForMember(aliceProject.id, bob.user.id))?.role).toBe("MEMBER");

    await expect(
      projects.update(bob.user, aliceProject.id, { name: "Bob was here" })
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      projects.delete(bob.user, aliceProject.id)
    ).rejects.toMatchObject({ status: 404 });

    const nextKey = await projects.createKey(alice.user, aliceProject.id, {});
    await expect(projects.rotateKey(bob.user, aliceProject.id, nextKey.id)).rejects.toMatchObject({ status: 404 });
  });

  it("shows each ingestion key's raw value exactly once and stores only its hash", async () => {
    const created = await projects.createKey(alice.user, aliceProject.id, { name: "sdk" });
    expect(created.key).toMatch(/^dbg_live_[0-9a-f]{48}$/);
    expect(created.prefix).toBe(created.key.slice(0, 13));

    const stored = await prisma.ingestionKey.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.keyHash).not.toBe(created.key);
    expect(stored.keyHash).toHaveLength(64);
    const listing = await projects.listKeys(aliceProject.id, alice.user.id);
    expect(JSON.stringify(listing)).not.toContain(created.key);
  });

  it("immediately rejects revoked keys and rotated-away keys", async () => {
    const key = await projects.createKey(alice.user, aliceProject.id, {});
    let allowed = await guard.canActivate(guardRequest(undefined, { "x-debugany-key": key.key }));
    expect(allowed).toBe(true);

    await projects.revokeKey(alice.user, aliceProject.id, key.id);
    await expect(guard.canActivate(guardRequest(undefined, { "x-debugany-key": key.key }))).rejects.toMatchObject({
      status: 401
    });

    const active = await projects.createKey(alice.user, aliceProject.id, {});
    const rotated = await projects.rotateKey(alice.user, aliceProject.id, active.id);
    await expect(guard.canActivate(guardRequest(undefined, { "x-debugany-key": active.key }))).rejects.toMatchObject({
      status: 401
    });
    expect(await guard.canActivate(guardRequest(undefined, { "x-debugany-key": rotated.key }))).toBe(true);
    await projects.revokeKey(alice.user, aliceProject.id, rotated.id);
  });

  it("scopes issues, events, and metrics to the owning project", async () => {
    const ingested = await core.processEvent(aliceProject, {
      message: "isolation probe",
      errorType: "IsoError",
      occurredAt: new Date().toISOString()
    }, `iso-job-${Date.now()}`);
    const bobProject = await projects.create(bob.user, {
      name: "Bob Project",
      slug: `bob-${Math.random().toString(36).slice(2, 10)}`
    });

    const aliceDetail = await issues.getWithEvents(aliceProject.id, ingested.issue.id, 25, 0);
    expect(aliceDetail.totalEvents).toBe(1);
    await expect(
      issues.getWithEvents(bobProject.id, ingested.issue.id, 25, 0)
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      issues.updateStatus(bobProject.id, ingested.issue.id, "RESOLVED", bob.user.id)
    ).rejects.toMatchObject({ status: 404 });

    await issues.updateStatus(aliceProject.id, ingested.issue.id, "RESOLVED", alice.user.id);
    expect(
      (await prisma.issue.findUniqueOrThrow({ where: { id: ingested.issue.id } })).status
    ).toBe("RESOLVED");

    await projects.delete(bob.user, bobProject.id);
  });

  it("records audit entries for sensitive actions", async () => {
    const logs = await prisma.auditLog.findMany({
      where: { projectId: aliceProject.id },
      orderBy: { createdAt: "asc" },
      select: { action: true, userId: true }
    });
    const actions = logs.map((l) => l.action);
    expect(actions).toContain("project.created");
    expect(actions).toContain("key.created");
    expect(actions).toContain("key.revoked");
    expect(actions).toContain("key.rotated");
    expect(actions).toContain("issue.status_changed");
    expect(logs.every((l) => l.userId === alice.user.id || l.userId === bob.user.id)).toBe(true);
  });

  it("deletes the project and cascades data, keeping audit history", async () => {
    await projects.delete(alice.user, aliceProject.id);
    expect(await prisma.project.findUnique({ where: { id: aliceProject.id } })).toBeNull();
    const remaining = await prisma.auditLog.count({ where: { projectId: aliceProject.id } });
    expect(remaining).toBeGreaterThan(0);
  });
});
