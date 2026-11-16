import { defineConfig } from "drizzle-kit"

// Migrations run as app_owner (DATABASE_OWNER_URL), never as app_user.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dbCredentials: { url: process.env.DATABASE_OWNER_URL ?? "" },
})
