import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/auth/password";
import { generateIngestionKey, keyPrefix, sha256 } from "../src/auth/tokens";

const prisma = new PrismaClient();

// Local development seed. Prints credentials once; never commit them.
// The demo user/password is for local use only.
async function main() {
  const email = "demo@debugany.local";
  const password = `demo-${randomBytes(9).toString("base64url")}`;

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: "Demo User", passwordHash: await hashPassword(password) }
  });

  const apiKey = generateIngestionKey();
  const existingProject = await prisma.project.findUnique({ where: { slug: "demo-app" } });

  if (!existingProject) {
    await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: { name: "Demo Application", slug: "demo-app" }
      });
      await tx.projectMember.create({
        data: { projectId: project.id, userId: user.id, role: "OWNER" }
      });
      await tx.ingestionKey.create({
        data: { projectId: project.id, keyHash: sha256(apiKey), prefix: keyPrefix(apiKey), createdById: user.id }
      });
    });
    console.log(`Project ready: Demo Application (owner ${email})`);
    console.log("Dashboard login password (save it now; it will not be shown again):");
    console.log(password);
    console.log("Ingestion key (save it now; it will not be shown again):");
    console.log(apiKey);
  } else {
    console.log(`Demo project already exists (owner ${email}).`);
    console.log("Its password and ingestion key are not recoverable from the database.");
    console.log("Delete the demo user/project rows or the database volume for a fresh seed.");
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
