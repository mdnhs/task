import { createHash } from "node:crypto"
import { beforeEach, describe, expect, test } from "vitest"
import { withTenant } from "../../db/tenant-tx"
import { auditEvents } from "../../db/schema"
import { ownerQuery, ownerTenantQuery, resetDb, testDb } from "../../../test/db"
import { auditToCsv, canonicalJson, listAudit, recordAudit, verifyChain, type AuditInput } from "./index"

const A = "11111111-1111-4111-8111-111111111111"
const B = "22222222-2222-4222-8222-222222222222"
const db = testDb()
const now = new Date("2026-11-16T10:00:00.000Z")
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex")
const e1: AuditInput = { action: "task.created", entity: "task", entityId: "t1", actorId: "u1", before: null, after: { title: "x" } }
const e2: AuditInput = { action: "task.updated", entity: "task", entityId: "t1", actorId: "u1", before: { title: "x" }, after: { title: "y", n: [2, 1] } }
const rows = (t: string) => ownerTenantQuery(t, `SELECT * FROM audit_events ORDER BY seq`)

beforeEach(async () => {
  await resetDb()
  for (const t of [A, B]) await ownerQuery(`INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $2)`, [t, `t-${t.slice(0, 2)}`])
})

describe("hash chain", () => {
  test("each entry hashes the previous one", async () => {
    await withTenant(db, A, async (tx) => {
      await recordAudit(tx, A, e1, now)
      await recordAudit(tx, A, e2, now)
    })
    const [r1, r2] = await rows(A)
    expect(r1.prev_hash).toBe("GENESIS")
    expect(Number(r1.seq)).toBe(1)
    expect(r2.prev_hash).toBe(r1.hash)
    expect(r2.hash).toBe(
      sha256(String(r1.hash) + canonicalJson({ seq: 2, at: now.toISOString(), actorId: e2.actorId, action: e2.action, entity: e2.entity, entityId: e2.entityId, before: e2.before, after: e2.after })),
    )
    expect(await verifyChain(db, A)).toEqual({ ok: true })
  })
  test("canonicalJson sorts keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[{"y":2,"z":1}]},"b":1}')
  })
  test("null before/after (create/delete) and a null actor verify", async () => {
    await withTenant(db, A, async (tx) => {
      await recordAudit(tx, A, { ...e1, actorId: null, before: null, after: null }, now)
      await recordAudit(tx, A, { ...e1, before: { a: 1 }, after: null }, now)
    })
    expect(await verifyChain(db, A)).toEqual({ ok: true })
  })
  test("verifyChain on an empty tenant is ok", async () => {
    expect(await verifyChain(db, A)).toEqual({ ok: true })
  })
  test("chains are per tenant", async () => {
    await withTenant(db, A, (tx) => recordAudit(tx, A, e1, now))
    await withTenant(db, B, (tx) => recordAudit(tx, B, e1, now))
    expect((await rows(B))[0]).toMatchObject({ prev_hash: "GENESIS" })
    expect(Number((await rows(B))[0].seq)).toBe(1)
  })
  test("verifyChain detects a tampered row", async () => {
    await withTenant(db, A, async (tx) => {
      for (const i of [1, 2, 3]) await recordAudit(tx, A, { ...e1, entityId: String(i) }, now)
    })
    await ownerTenantQuery(A, `UPDATE audit_events SET after = '{"x":1}' WHERE seq = 2`)
    const r2 = (await rows(A))[1]
    expect(await verifyChain(db, A)).toEqual({ ok: false, brokenAt: r2.id })
  })
  test("verifyChain detects a deleted row (seq gap)", async () => {
    await withTenant(db, A, async (tx) => {
      for (const i of [1, 2, 3]) await recordAudit(tx, A, { ...e1, entityId: String(i) }, now)
    })
    await ownerTenantQuery(A, `DELETE FROM audit_events WHERE seq = 2`)
    const r3 = (await rows(A))[1]
    expect(await verifyChain(db, A)).toEqual({ ok: false, brokenAt: r3.id })
  })
  test("concurrent writes in one tenant keep seq gap-free", async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => withTenant(db, A, (tx) => recordAudit(tx, A, { ...e1, entityId: String(i) }, now))))
    expect((await rows(A)).map((r) => Number(r.seq))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(await verifyChain(db, A)).toEqual({ ok: true })
  })
  test("rolling back the caller's transaction leaves no audit row", async () => {
    await withTenant(db, A, async (tx) => {
      await recordAudit(tx, A, e1, now)
      throw new Error("boom")
    }).catch(() => undefined)
    expect(await rows(A)).toEqual([])
  })
})

describe("append-only", () => {
  const cause = (e: unknown) => (e as { cause?: { code?: string } }).cause?.code
  beforeEach(async () => {
    await withTenant(db, A, (tx) => recordAudit(tx, A, e1, now))
  })
  test("app_user cannot update, delete or truncate audit rows", async () => {
    const up = await withTenant(db, A, (tx) => tx.update(auditEvents).set({ action: "x" })).catch((e) => e)
    expect(cause(up)).toBe("42501")
    const del = await withTenant(db, A, (tx) => tx.delete(auditEvents)).catch((e) => e)
    expect(cause(del)).toBe("42501")
    const tr = await db.execute("TRUNCATE audit_events" as never).catch((e) => e)
    expect(cause(tr)).toBe("42501")
  })
  test("app_user holds only SELECT and INSERT on audit_events and owns nothing", async () => {
    const privs = await ownerQuery(`SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee = 'app_user' AND table_name = 'audit_events' ORDER BY 1`)
    expect(privs.map((p) => p.privilege_type)).toEqual(["INSERT", "SELECT"])
    expect(await ownerQuery(`SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = 'app_user'`)).toEqual([])
  })
  test("another tenant's rows are invisible and cannot be written", async () => {
    expect(await withTenant(db, B, (tx) => tx.select().from(auditEvents))).toEqual([])
    const err = await withTenant(db, B, (tx) => recordAudit(tx, A, e1, now)).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
  })
})

describe("listAudit", () => {
  test("filters by entity and date range, newest first", async () => {
    await withTenant(db, A, async (tx) => {
      await recordAudit(tx, A, e1, new Date("2026-11-01T00:00:00Z"))
      await recordAudit(tx, A, { ...e1, entity: "roster", entityId: "r1" }, new Date("2026-11-05T00:00:00Z"))
      await recordAudit(tx, A, e2, new Date("2026-11-10T00:00:00Z"))
    })
    expect((await listAudit(db, A, { entity: "task" })).map((r) => r.action)).toEqual(["task.updated", "task.created"])
    expect((await listAudit(db, A, { from: new Date("2026-11-04T00:00:00Z"), to: new Date("2026-11-06T00:00:00Z") })).map((r) => r.entity)).toEqual(["roster"])
    expect(await listAudit(db, B, {})).toEqual([])
  })
})

describe("auditToCsv", () => {
  test("header, who/what/when/old/new, escaping and formula safety", () => {
    const csv = auditToCsv([
      { at: now, actorId: "u1", action: "task.updated", entity: "task", entityId: "t1", before: { a: "x,y" }, after: null },
      { at: now, actorId: null, action: "=cmd", entity: "task", entityId: "t2", before: null, after: { q: 'he said "hi"' } },
    ])
    const lines = csv.split("\n")
    expect(lines[0]).toBe("at,actor,action,entity,entity_id,before,after")
    expect(lines[1]).toBe('2026-11-16T10:00:00.000Z,u1,task.updated,task,t1,"{""a"":""x,y""}",')
    expect(lines[2]).toBe(`2026-11-16T10:00:00.000Z,,'=cmd,task,t2,,"{""q"":""he said \\""hi\\""""}"`)
  })
})
