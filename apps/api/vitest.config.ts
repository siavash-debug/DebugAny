import { defineConfig } from "vitest/config";
import { config } from "dotenv";

// Load apps/api/.env so integration tests can reach the local database when it
// is available; they skip themselves when it is not.
config();

export default defineConfig({
  test: {
    include: ["test/**/*.spec.ts"],
    environment: "node"
  }
});
