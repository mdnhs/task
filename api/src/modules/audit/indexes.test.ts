import { readFileSync } from "node:fs"
import pg from "pg"
import { afterAll, beforeEach, describe, expect, test } from "vitest"
import { ownerQuery, ownerTenantQuery, resetDb, testDb } from "../../../test/db"
import { withTenant } from "../../db/tenant-tx"
import { auditPageQuery, recordAudit, verifyChain, type AuditInput } from "./index"

// B8 Task 16: the selective filters of the audit list (actor, exact action) have their own indexes (migration 0048).

const A = "11111111-1111-4111-8111-111111111111"
const B = "22222222-2222-4222-8222-222222222222"
const db = testDb()
const now = new Date("2026-11-16T10:00:00.000Z")
const owner = new pg.Pool({ connectionString: process.env.TEST_DATABASE_OWNER_URL, max: 2 })
afterAll(() => owner.end())
const file = readFileSync(new URL("../../db/migrations/0048_audit_filter_indexes.sql", import.meta.url), "utf8")
const statements = file.split("--> statement-breakpoint").filter((s) => s.trim())

beforeEach(async () => {
  await resetDb()
  for (const t of [A, B]) await ownerQuery(`INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $2)`, [t, `t-${t.slice(0, 2)}`])
})

const chainOf = async (tenant: string, n: number) => {
  await withTenant(db, tenant, async (tx) => {
    for (let i = 0; i < n; i++) await recordAudit(tx, tenant, { action: `task.${i % 3 === 0 ? "created" : "updated"}`, entity: "task", entityId: `t${i}`, actorId: `u${i % 2}`, before: null, after: { i } } satisfies AuditInput, now)
  })
}
const indexNames = async () => (await ownerQuery("select indexname from pg_indexes where tablename = 'audit_events' and indexname like 'audit_events_a%' order by 1")).map((r) => r.indexname)

describe("audit filter indexes (B8 T16)", () => {
  test("EXPLAIN of the audit list with an actorId filter and with an action filter uses the new indexes on a 5 000-row tenant (plan text names them); the plain list keeps the chain index", async () => {
    // 5 000 rows for tenant A: 100 actors, 40 actions (the hashes are fake: this tenant is for the planner only)
    await ownerTenantQuery(A, `insert into audit_events (id, tenant_id, seq, at, actor_id, action, entity, entity_id, prev_hash, hash)
      select gen_random_uuid(), $1, g, timestamptz '2026-11-01' + (g || ' seconds')::interval, 'usr_' || (g % 100), 'act.' || (g % 40), 'task', g::text, 'p', 'h' from generate_series(1, 5000) g`, [A])
    await ownerQuery("analyze audit_events")
    const plans = await withTenant(db, A, async (tx) => ({
      actor: auditPageQuery(tx, A, { actorId: "usr_7" }, undefined, 26).toSQL(),
      action: auditPageQuery(tx, A, { action: "act.3" }, undefined, 26).toSQL(),
      actorPaged: auditPageQuery(tx, A, { actorId: "usr_7" }, 4000, 26).toSQL(),
      plain: auditPageQuery(tx, A, {}, undefined, 26).toSQL(),
      entity: auditPageQuery(tx, A, { entity: "task", from: new Date("2026-11-01T00:00:00Z") }, undefined, 26).toSQL(),
    }))
    const c = await owner.connect()
    const explain = async (p: { sql: string; params: unknown[] }) => {
      await c.query("begin")
      await c.query("select set_config('app.tenant_id', $1, true)", [A])
      const text = (await c.query(`explain ${p.sql}`, p.params as unknown[])).rows.map((r) => r["QUERY PLAN"] as string).join("\n")
      await c.query("rollback")
      return text
    }
    try {
      expect(await explain(plans.actor)).toContain("audit_events_actor_idx")
      expect(await explain(plans.actorPaged)).toContain("audit_events_actor_idx")
      expect(await explain(plans.action)).toContain("audit_events_action_idx")
      expect(await explain(plans.actor)).not.toMatch(/Seq Scan on audit_events/)
      expect(await explain(plans.plain)).toContain("audit_events_tenant_seq")
    } finally {
      c.release()
    }
  })

  test("migration 0048 replayed as app_owner with NO tenant context (twice) over two chained tenants creates both indexes, leaves every row untouched and the audit chains verify", async () => {
    await chainOf(A, 12)
    await chainOf(B, 7)
    const before = {
      a: await ownerTenantQuery(A, "select seq, hash from audit_events order by seq"),
      b: await ownerTenantQuery(B, "select seq, hash from audit_events order by seq"),
    }
    expect(await indexNames()).toEqual(["audit_events_action_idx", "audit_events_actor_idx"])
    await ownerQuery("drop index audit_events_actor_idx") // the state before 0048
    await ownerQuery("drop index audit_events_action_idx")
    expect(await indexNames()).toEqual([])
    const c = await owner.connect()
    try {
      await c.query("begin") // the migrator runs the file in one transaction
      expect(String((await c.query("select current_setting('app.tenant_id', true) as t")).rows[0].t ?? "")).toBe("")
      for (let pass = 0; pass < 2; pass++) for (const stmt of statements) await c.query(stmt) // a replay is harmless (IF NOT EXISTS)
      expect(String((await c.query("select current_setting('app.tenant_id', true) as t")).rows[0].t ?? "")).toBe("")
      await c.query("commit")
    } finally {
      c.release()
    }
    expect(await indexNames()).toEqual(["audit_events_action_idx", "audit_events_actor_idx"])
    expect(await ownerTenantQuery(A, "select seq, hash from audit_events order by seq")).toEqual(before.a)
    expect(await ownerTenantQuery(B, "select seq, hash from audit_events order by seq")).toEqual(before.b)
    expect(await verifyChain(db, A)).toMatchObject({ ok: true, head: { seq: 12 } })
    expect(await verifyChain(db, B)).toMatchObject({ ok: true, head: { seq: 7 } })
    await chainOf(A, 1) // and the chain keeps growing
    expect(await verifyChain(db, A)).toMatchObject({ ok: true, head: { seq: 13 } })
  })

  test("the file is plain CREATE INDEX IF NOT EXISTS (no CONCURRENTLY, which cannot run in the migrator's transaction), names the lock cost, and the journal and snapshot follow 0047", () => {
    expect(file).not.toMatch(/CREATE\s+INDEX\s+CONCURRENTLY/i)
    expect(statements.filter((s) => /^\s*CREATE INDEX IF NOT EXISTS "audit_events_(actor|action)_idx"/m.test(s))).toHaveLength(2)
    expect(file).toMatch(/LOCK COST/)
    const j = JSON.parse(readFileSync(new URL("../../db/migrations/meta/_journal.json", import.meta.url), "utf8")) as { entries: { idx: number; tag: string }[] }
    expect(j.entries.slice(47, 49).map((e) => [e.idx, e.tag])).toEqual([[47, "0047_roster_auto_repeat_backoff"], [48, "0048_audit_filter_indexes"]])
    const s = JSON.parse(readFileSync(new URL("../../db/migrations/meta/0048_snapshot.json", import.meta.url), "utf8")) as { prevId: string; tables: Record<string, { indexes: Record<string, unknown> }> }
    const prev = JSON.parse(readFileSync(new URL("../../db/migrations/meta/0047_snapshot.json", import.meta.url), "utf8")) as { id: string }
    expect(s.prevId).toBe(prev.id)
    expect(Object.keys(s.tables["public.audit_events"].indexes)).toEqual(expect.arrayContaining(["audit_events_actor_idx", "audit_events_action_idx"]))
  })
})
