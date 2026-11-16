import { pgTable, text, uuid } from "drizzle-orm/pg-core"

// Test-only table (created in global setup, never in production migrations).
export const rlsProbe = pgTable("rls_probe", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  label: text("label").notNull(),
})
