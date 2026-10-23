import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const apiKey = `dbg_live_${randomBytes(24).toString("hex")}`;
  const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");
  const project = await prisma.project.upsert({
    where: { slug: "demo-app" },
    update: {},
    create: {
      name: "Demo Application",
      slug: "demo-app",
      apiKeyHash
    }
  });

  console.log(`Project ready: ${project.name} (${project.id})`);
  if (project.apiKeyHash === apiKeyHash) {
    console.log("Save this ingestion key now; it will not be shown again:");
    console.log(apiKey);
  } else {
    console.log("A demo project already exists. Its original API key is not recoverable from the database.");
    console.log("Delete and recreate the demo project if you need a fresh key.");
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());