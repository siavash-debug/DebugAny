import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../src/prisma/prisma.service";
import { generateIngestionKey, keyPrefix, sha256 } from "../src/auth/tokens";
import { hashPassword } from "../src/auth/password";
import type { AuthenticatedUser } from "../src/auth/auth.service";

export interface TestUser {
  dbId: string;
  user: AuthenticatedUser;
}

export async function createUser(prisma: PrismaService, label: string): Promise<TestUser> {
  const email = `${label}-${randomBytes(6).toString("hex")}@test.debugany.local`;
  const created = await prisma.user.create({
    data: { email, name: label, passwordHash: await hashPassword("test-password-123") }
  });
  return { dbId: created.id, user: { id: created.id, email: created.email, name: created.name } };
}

export async function createProjectOwnedBy(
  prisma: PrismaService,
  owner: TestUser,
  slugPrefix: string
): Promise<{ id: string; name: string; slug: string }> {
  const slug = `${slugPrefix}-${randomBytes(5).toString("hex")}`;
  const project = await prisma.project.create({
    data: {
      name: `Project ${slug}`,
      slug,
      members: { create: { userId: owner.dbId, role: "OWNER" } }
    }
  });
  return { id: project.id, name: project.name, slug: project.slug };
}

export async function createIngestionKey(
  prisma: PrismaService,
  projectId: string
): Promise<string> {
  const raw = generateIngestionKey();
  await prisma.ingestionKey.create({
    data: { projectId, keyHash: sha256(raw), prefix: keyPrefix(raw) }
  });
  return raw;
}

export function legacySha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
