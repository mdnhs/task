import { sql } from "drizzle-orm"
import { date, pgPolicy, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"

const tenantMatch = sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`

/** Tenant public holidays (calendar dates, no time zone). */
export const publicHolidays = pgTable(
  "public_holidays",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    name: text("name").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.date] }),
    pgPolicy("tenant_isolation", { as: "permissive", for: "all", using: tenantMatch, withCheck: tenantMatch }),
  ],
).enableRLS()
