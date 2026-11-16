import { sql } from "drizzle-orm"
import { customType, index, pgPolicy, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"

// Standard RLS template (R8); FORCE is appended by hand in the migration.
const tenantMatch = sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" })

/**
 * Denormalised global-search index (T2.5). One row per searchable entity; `module` is the permission module a caller
 * needs `read` on to see the hit. `tsv` is generated: title weighted A, body default. 'simple' config on purpose
 * (tenant content is multilingual; no stemming or stop words). Emails are never indexed.
 */
export const searchDocuments = pgTable(
  "search_documents",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    module: text("module").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    tsv: tsvector("tsv").generatedAlwaysAs(sql`setweight(to_tsvector('simple', title), 'A') || to_tsvector('simple', body)`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.entity, t.entityId] }),
    index("search_documents_tsv_idx").using("gin", t.tsv),
    index("search_documents_title_trgm_idx").using("gin", sql`lower(${t.title}) gin_trgm_ops`),
    pgPolicy("tenant_isolation", { as: "permissive", for: "all", using: tenantMatch, withCheck: tenantMatch }),
  ],
).enableRLS()
