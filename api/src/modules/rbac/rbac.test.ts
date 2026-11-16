import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { call, resetDb, testApp } from "../../../test/harness"
import { eq } from "drizzle-orm"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { memberships } from "../../db/schema"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import { makeMember, makeTenant, roleIdOf, signIn } from "../../../test/factories"
import { changeMemberRole, cloneRole, updateRole } from "./service"
import { requireTenant } from "../../core/middleware/tenant"
import { requirePermission } from "../../core/middleware/permission"
import { redactFields } from "./index"

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const rolesJson = (JSON.parse(readFileSync(new URL("../../../../public/data/shell/roles.json", import.meta.url), "utf8")) as { roles: { id: string; access: Record<string, string> }[] }).roles.filter((r) => r.id !== "platform")
beforeEach(resetDb)

async function world() {
  const t = testApp()
  // test-only probes, guarded exactly like real routes
  t.app.post("/v1/_probe/tasks", requireTenant, requirePermission("tasks", "write"), (c) => c.json({ ok: true }))
  t.app.get("/v1/_probe/tasks", requireTenant, requirePermission("tasks", "read"), (c) => c.json({ ok: true }))
  t.app.get("/v1/_probe/twice", requireTenant, requirePermission("tasks", "read"), requirePermission("reports", "read"), (c) => c.json({ ok: true }))
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  const who = async (key: string) => {
    const m = await makeMember(t.deps, tenant.id, key)
    return { ...m, cookie: (await signIn(t.app, m.email, m.password)).cookie }
  }
  const owner = await who("owner")
  const admin = await who("admin")
  // custom actor: settings write but no audit access (admin minus audit)
  await ownerTenantQuery(tenant.id, "insert into roles (tenant_id, key, label, home, access) select tenant_id, 'limited', 'Limited', home, access || '{\"audit\":\"none\"}'::jsonb from roles where key='admin'")
  const limited = await who("limited")
  const req = (method: string, path: string, as: { cookie: string } | null, body?: unknown, slug = "acme") =>
    call(t.app, method, path, { cookie: as?.cookie, tenant: slug, body })
  const accessOf = async (id: string) => (await ownerTenantQuery(tenant.id, "select access from roles where id=$1", [id]))[0]?.access as Record<string, string>
  const lastAudit = async () => (await ownerTenantQuery(tenant.id, "select * from audit_events order by seq desc limit 1"))[0] as Json
  return { ...t, tenant, who, owner, admin, limited, req, accessOf, lastAudit, roleId: (k: string) => roleIdOf(t.deps, tenant.id, k) }
}

describe("templates and guard", () => {
  test("new tenant gets one template per role in shell/roles.json", async () => {
    const w = await world()
    const rows = await ownerTenantQuery(w.tenant.id, "select key, is_template, access from roles")
    expect(rows.filter((r) => r.is_template).map((r) => r.key).sort()).toEqual(rolesJson.map((r) => r.id).sort())
    expect(rows.find((r) => r.key === "manager")!.access).toEqual(rolesJson.find((r) => r.id === "manager")!.access)
  })

  test("requirePermission blocks write for a read-only role with 403 forbidden (problem+json)", async () => {
    const w = await world()
    const auditor = await w.who("auditor") // tasks: read
    const r = await w.req("POST", "/v1/_probe/tasks", auditor)
    expect(r.status).toBe(403)
    expect(r.headers.get("content-type")).toContain("application/problem+json")
    expect(await r.json()).toMatchObject({ code: "forbidden", status: 403 })
    expect((await w.req("GET", "/v1/_probe/tasks", auditor)).status).toBe(200) // write implies read, read passes read
    const emp = await w.who("employee") // tasks: write
    expect((await w.req("POST", "/v1/_probe/tasks", emp)).status).toBe(200)
    const supervisorLoc = await w.who("location-supervisor") // tasks read only, reports none
    expect((await w.req("GET", "/v1/_probe/twice", supervisorLoc)).status).toBe(403)
    expect((await w.req("POST", "/v1/_probe/tasks", null)).status).toBe(401)
  })

  test("the member's role is loaded once per request, however many guards stack", async () => {
    const w = await world()
    const emp = await w.who("employee")
    const spy = vi.spyOn(w.deps.db, "transaction")
    await w.req("GET", "/v1/_probe/tasks", emp)
    const one = spy.mock.calls.length
    spy.mockClear()
    await w.req("GET", "/v1/_probe/twice", emp)
    expect(spy.mock.calls.length).toBe(one)
    spy.mockRestore()
  })
})

describe("roles", () => {
  test("template roles are read-only; PATCH on a template is 409 template_locked", async () => {
    const w = await world()
    const r = await w.req("PATCH", `/v1/roles/${await w.roleId("manager")}`, w.owner, { label: "x" })
    expect(r.status).toBe(409)
    expect(((await r.json()) as Json).code).toBe("template_locked")
  })

  test("clone copies access, records cloned_from, and edits leave the template unchanged", async () => {
    const w = await world()
    const tpl = await w.roleId("manager")
    const tplAccess = await w.accessOf(tpl)
    const cr = await w.req("POST", `/v1/roles/${tpl}/clone`, w.owner, { label: "Night lead" })
    expect(cr.status).toBe(201)
    const c = (await cr.json()) as Json
    expect(c).toMatchObject({ label: "Night lead", isTemplate: false, clonedFrom: tpl, access: tplAccess })
    const p = await w.req("PATCH", `/v1/roles/${c.id}`, w.owner, { access: { ...tplAccess, payroll: "none" } })
    expect(p.status).toBe(200)
    expect(await w.accessOf(tpl)).toEqual(tplAccess)
    expect(await w.accessOf(c.id)).toMatchObject({ payroll: "none" })
    const row = (await ownerTenantQuery(w.tenant.id, "select cloned_from from roles where id=$1", [c.id]))[0]
    expect(row.cloned_from).toBe(tpl)
  })

  test("cloning twice with the same label gets distinct keys", async () => {
    const w = await world()
    const tpl = await w.roleId("manager")
    const a = (await (await w.req("POST", `/v1/roles/${tpl}/clone`, w.owner, { label: "Manager" })).json()) as Json
    const b = (await (await w.req("POST", `/v1/roles/${tpl}/clone`, w.owner, { label: "Manager" })).json()) as Json
    expect(new Set([a.key, b.key, "manager"]).size).toBe(3)
  })

  test("permission change is audited with old and new access (AC-M0-04)", async () => {
    const w = await world()
    const tpl = await w.roleId("manager")
    const tplAccess = await w.accessOf(tpl)
    const c = (await (await w.req("POST", `/v1/roles/${tpl}/clone`, w.owner, { label: "Night lead" })).json()) as Json
    await w.req("PATCH", `/v1/roles/${c.id}`, w.owner, { access: { payroll: "none" } })
    expect(await w.lastAudit()).toMatchObject({
      action: "role.updated", entity: "role", entity_id: c.id, actor_id: w.owner.userId,
      before: { access: tplAccess }, after: { access: { ...tplAccess, payroll: "none" } },
    })
  })

  test("field rules are stored on a custom role and audited", async () => {
    const w = await world()
    const c = (await (await w.req("POST", `/v1/roles/${await w.roleId("manager")}/clone`, w.owner, { label: "Lead" })).json()) as Json
    const r = await w.req("PATCH", `/v1/roles/${c.id}`, w.owner, { fieldRules: { member: ["payRate", "bank.iban"] } })
    expect(((await r.json()) as Json).fieldRules).toEqual({ member: ["payRate", "bank.iban"] })
    expect((await w.lastAudit()).after).toMatchObject({ fieldRules: { member: ["payRate", "bank.iban"] } })
  })

  test("GET /v1/roles lists the tenant's roles; needs settings read", async () => {
    const w = await world()
    const r = await w.req("GET", "/v1/roles", w.owner)
    expect(((await r.json()) as Json[]).length).toBe(rolesJson.length + 1) // + the custom "limited" role from world()
    expect((await w.req("GET", "/v1/roles", await w.who("employee"))).status).toBe(403)
  })

  test("a role without settings write cannot clone or edit", async () => {
    const w = await world()
    const auditor = await w.who("auditor") // settings: read
    expect((await w.req("POST", `/v1/roles/${await w.roleId("manager")}/clone`, auditor, { label: "x" })).status).toBe(403)
  })

  test("role id from another tenant is 404 (never 403)", async () => {
    const w = await world()
    const other = await makeTenant(w.deps)
    const foreign = await roleIdOf(w.deps, other.id, "manager")
    expect((await w.req("PATCH", `/v1/roles/${foreign}`, w.owner, { label: "x" })).status).toBe(404)
    expect((await w.req("POST", `/v1/roles/${foreign}/clone`, w.owner, { label: "x" })).status).toBe(404)
    const m = await w.who("employee")
    expect((await w.req("PATCH", `/v1/members/${m.userId}`, w.owner, { roleId: foreign })).status).toBe(404)
  })

  test("bad bodies are 400; unknown modules and levels are rejected", async () => {
    const w = await world()
    const c = (await (await w.req("POST", `/v1/roles/${await w.roleId("manager")}/clone`, w.owner, { label: "Lead" })).json()) as Json
    for (const body of [{}, { access: { payrol: "write" } }, { access: { payroll: "admin" } }, { label: "" }, { fieldRules: { member: ["a b"] } }])
      expect((await w.req("PATCH", `/v1/roles/${c.id}`, w.owner, body)).status).toBe(400)
    expect((await w.req("POST", `/v1/roles/not-a-uuid/clone`, w.owner, { label: "x" })).status).toBe(400)
  })
})

describe("no escalation (R24: administrative modules only)", () => {
  test("operational access does not count: admin can assign manager; a role-editor without audit access cannot", async () => {
    const w = await world()
    const emp = await w.who("employee")
    const mgr = await w.roleId("manager") // tasks:write, audit:write
    expect((await w.req("PATCH", `/v1/members/${emp.userId}`, w.admin, { roleId: mgr })).status).toBe(200)
    const emp2 = await w.who("employee")
    const r = await w.req("PATCH", `/v1/members/${emp2.userId}`, w.limited, { roleId: mgr }) // audit:write > limited's none
    expect(r.status).toBe(403)
    expect(((await r.json()) as Json).code).toBe("role_escalation")
    expect(await w.lastAudit()).toMatchObject({ action: "member.role_changed", entity_id: emp.userId, before: { roleKey: "employee" }, after: { roleKey: "manager" } })
  })

  test("only an owner assigns, or takes away, the owner role", async () => {
    const w = await world()
    const emp = await w.who("employee")
    expect((await w.req("PATCH", `/v1/members/${emp.userId}`, w.admin, { roleId: await w.roleId("owner") })).status).toBe(403)
    const second = await w.who("owner")
    expect((await w.req("PATCH", `/v1/members/${second.userId}`, w.admin, { roleId: await w.roleId("employee") })).status).toBe(403)
    expect((await w.req("PATCH", `/v1/members/${emp.userId}`, w.owner, { roleId: await w.roleId("owner") })).status).toBe(200)
  })

  test("a non-owner cannot raise an administrative module of a role above their own; operational modules are free", async () => {
    const w = await world()
    const c = (await (await w.req("POST", `/v1/roles/${await w.roleId("employee")}/clone`, w.limited, { label: "Crew" })).json()) as Json
    const up = await w.req("PATCH", `/v1/roles/${c.id}`, w.limited, { access: { audit: "write" } })
    expect(up.status).toBe(403)
    expect(((await up.json()) as Json).code).toBe("role_escalation")
    expect((await w.req("PATCH", `/v1/roles/${c.id}`, w.limited, { access: { audit: "none", payroll: "write" } })).status).toBe(200)
    expect((await w.req("PATCH", `/v1/roles/${c.id}`, w.owner, { access: { audit: "write" } })).status).toBe(200)
  })

  test("a non-owner cannot edit a role that outranks them on an administrative module (any kind of patch)", async () => {
    const w = await world()
    await ownerTenantQuery(w.tenant.id, "insert into roles (tenant_id, key, label, home, access) select tenant_id, 'adminc', 'Admin copy', home, access from roles where key='admin'")
    const rid = (await ownerTenantQuery(w.tenant.id, "select id from roles where key='adminc'"))[0].id as string
    const before = (await ownerTenantQuery(w.tenant.id, "select label, access, field_rules from roles where id=$1", [rid]))[0]
    for (const body of [{ access: { audit: "none" } }, { label: "Renamed" }, { fieldRules: { member: ["payRate"] } }, { access: { payroll: "write" } }]) {
      const r = await w.req("PATCH", `/v1/roles/${rid}`, w.limited, body) // limited: audit none < adminc's audit write
      expect(r.status).toBe(403)
      expect(((await r.json()) as Json).code).toBe("role_escalation")
    }
    expect((await ownerTenantQuery(w.tenant.id, "select label, access, field_rules from roles where id=$1", [rid]))[0]).toEqual(before)
    expect((await w.req("PATCH", `/v1/roles/${rid}`, w.owner, { access: { audit: "none" } })).status).toBe(200)
  })

  test("two holders of a role patching it at once never hit a deadlock (no 500)", async () => {
    const w = await world()
    await ownerTenantQuery(w.tenant.id, "insert into roles (tenant_id, key, label, home, access) select tenant_id, 'adminc', 'Admin copy', home, access from roles where key='admin'")
    const rid = (await ownerTenantQuery(w.tenant.id, "select id from roles where key='adminc'"))[0].id as string
    const a = await w.who("adminc")
    const b = await w.who("adminc")
    for (let i = 0; i < 6; i++) {
      const rs = await Promise.all([
        w.req("PATCH", `/v1/roles/${rid}`, a, { label: `A${i}` }),
        w.req("PATCH", `/v1/roles/${rid}`, b, { label: `B${i}` }),
        w.req("PATCH", `/v1/members/${b.userId}`, a, { roleId: await w.roleId("employee") }).then(async (r) => {
          await w.req("PATCH", `/v1/members/${b.userId}`, w.owner, { roleId: rid }) // put b back
          return r
        }),
      ])
      for (const r of rs) expect(r.status).toBeLessThan(500)
    }
  })

  test("fieldRules edits need settings write and no further check", async () => {
    const w = await world()
    const c = (await (await w.req("POST", `/v1/roles/${await w.roleId("employee")}/clone`, w.limited, { label: "Crew" })).json()) as Json
    expect((await w.req("PATCH", `/v1/roles/${c.id}`, w.limited, { fieldRules: { member: ["payRate"] } })).status).toBe(200)
    expect((await w.req("PATCH", `/v1/roles/${c.id}`, await w.who("auditor"), { fieldRules: {} })).status).toBe(403)
  })

  test("the owner template cannot be cloned (409 owner_not_clonable), not even by an owner", async () => {
    const w = await world()
    const r = await w.req("POST", `/v1/roles/${await w.roleId("owner")}/clone`, w.owner, { label: "Boss" })
    expect(r.status).toBe(409)
    expect(r.headers.get("content-type")).toContain("application/problem+json")
    expect(((await r.json()) as Json).code).toBe("owner_not_clonable")
  })

  test("PATCH member for an unknown or foreign user is 404", async () => {
    const w = await world()
    const other = await makeTenant(w.deps)
    const foreign = await makeMember(w.deps, other.id, "employee")
    const role = await w.roleId("employee")
    expect((await w.req("PATCH", `/v1/members/${foreign.userId}`, w.owner, { roleId: role })).status).toBe(404)
    expect((await w.req("PATCH", `/v1/members/nobody`, w.owner, { roleId: role })).status).toBe(404)
  })
})

describe("actor re-check inside the mutation tx (R25)", () => {
  test("an actor demoted by a concurrent tx is rejected, even though the request's guard saw the old role", async () => {
    const w = await world()
    const emp = await w.who("employee")
    const target = await w.roleId("manager")
    const employeeRole = await w.roleId("employee")
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let locked!: () => void
    const held = new Promise<void>((r) => (locked = r))
    // concurrent tx demotes the acting admin and stays open (holds the row lock)
    const demote = withTenant(w.deps.db, w.tenant.id, async (tx) => {
      await tx.update(memberships).set({ roleId: employeeRole }).where(eq(memberships.userId, w.admin.userId))
      locked()
      await gate
    })
    await held
    const pending = w.req("PATCH", `/v1/members/${emp.userId}`, w.admin, { roleId: target }) // guard reads the committed (admin) role
    for (let i = 0; i < 100; i++) {
      const waiting = await ownerQuery("select 1 from pg_locks where not granted and locktype in ('transactionid','tuple')")
      if (waiting.length) break
      await new Promise((r) => setTimeout(r, 50))
    }
    release()
    await demote
    const r = await pending
    expect(r.status).toBe(403)
    expect(((await r.json()) as Json).code).toBe("forbidden")
    const row = (await ownerTenantQuery(w.tenant.id, "select r.key from memberships m join roles r on r.id=m.role_id where m.user_id=$1", [emp.userId]))[0]
    expect(row.key).toBe("employee")
  })
})

describe("M6: services refuse an apikey actor (defence in depth behind the deny-list)", () => {
  test("clone, edit and assign each answer 403 api_key_forbidden_route before touching anything", async () => {
    const w = await world()
    const actor = { userId: `apikey:${w.owner.userId}` }
    const adminRole = await w.roleId("admin")
    const employeeRole = await w.roleId("employee")
    const run = (f: (tx: TenantTx) => Promise<unknown>) => withTenant(w.deps.db, w.tenant.id, f)
    const now = w.clock.now()
    for (const f of [
      (tx: TenantTx) => cloneRole(tx, w.tenant.id, actor, adminRole, "Copy", now),
      (tx: TenantTx) => updateRole(tx, w.tenant.id, actor, adminRole, { label: "x" }, now),
      (tx: TenantTx) => changeMemberRole(tx, w.tenant.id, actor, w.admin.userId, employeeRole, now),
    ]) {
      await expect(run(f)).rejects.toMatchObject({ status: 403, code: "api_key_forbidden_route" })
    }
    expect(await ownerTenantQuery(w.tenant.id, "select 1 from audit_events where action like 'role.%'")).toEqual([])
  })
})

describe("last owner", () => {
  test("last owner cannot be demoted (409 last_owner)", async () => {
    const w = await world()
    const r = await w.req("PATCH", `/v1/members/${w.owner.userId}`, w.owner, { roleId: await w.roleId("employee") })
    expect(r.status).toBe(409)
    expect(((await r.json()) as Json).code).toBe("last_owner")
    expect((await ownerTenantQuery(w.tenant.id, "select 1 from memberships m join roles r on r.id=m.role_id where r.key='owner'")).length).toBe(1)
  })

  test("with two owners one may step down", async () => {
    const w = await world()
    await w.who("owner")
    expect((await w.req("PATCH", `/v1/members/${w.owner.userId}`, w.owner, { roleId: await w.roleId("employee") })).status).toBe(200)
  })

  test("two owners demoting each other at once: exactly one succeeds, an owner always remains", async () => {
    const w = await world()
    const b = await w.who("owner")
    const emp = await w.roleId("employee")
    const [r1, r2] = await Promise.all([
      w.req("PATCH", `/v1/members/${b.userId}`, w.owner, { roleId: emp }),
      w.req("PATCH", `/v1/members/${w.owner.userId}`, b, { roleId: emp }),
    ])
    // The loser is 409 last_owner, or 403 when the winner's demotion committed before the loser's own guard ran.
    const [ok, lost] = [r1.status, r2.status].sort()
    expect(ok).toBe(200)
    expect([403, 409]).toContain(lost)
    expect((await ownerTenantQuery(w.tenant.id, "select 1 from memberships m join roles r on r.id=m.role_id where r.key='owner'")).length).toBe(1)
  })
})

describe("redactFields", () => {
  const roleWith = (fieldRules: Record<string, string[]>) => ({ fieldRules })
  test("removes hidden paths only for that role and entity", () => {
    expect(redactFields(roleWith({ member: ["payRate"] }), "member", { name: "A", payRate: 14 })).toEqual({ name: "A" })
    expect(redactFields(roleWith({ member: ["payRate"] }), "task", { name: "A", payRate: 14 })).toEqual({ name: "A", payRate: 14 })
    expect(redactFields(roleWith({}), "member", { payRate: 14 })).toEqual({ payRate: 14 })
  })
  test("handles nested paths and arrays without mutating the input", () => {
    const row = { name: "A", bank: { iban: "X", bic: "Y" }, kids: [{ dob: 1, n: "a" }, { dob: 2, n: "b" }] }
    const out = redactFields(roleWith({ member: ["bank.iban", "kids.dob", "missing.deep"] }), "member", row)
    expect(out).toEqual({ name: "A", bank: { bic: "Y" }, kids: [{ n: "a" }, { n: "b" }] })
    expect(row.bank.iban).toBe("X")
  })
  test("a role with no rules, or inherited keys, hides nothing", () => {
    expect(redactFields({}, "member", { a: 1 })).toEqual({ a: 1 })
    expect(redactFields(roleWith({}), "constructor", { a: 1 })).toEqual({ a: 1 })
  })
})
