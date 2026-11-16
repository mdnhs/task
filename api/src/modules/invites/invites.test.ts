import { beforeEach, expect, test } from "vitest"
import { call, resetDb, testApp } from "../../../test/harness"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { makeMember, makeTenant, roleIdOf, signIn, signUp } from "../../../test/factories"

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
beforeEach(resetDb)

async function world() {
  const t = testApp()
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  // The inviter is an owner: invites may not exceed the inviter's own access (no escalation), and only owners hold every module.
  const admin = await makeMember(t.deps, tenant.id, "owner")
  const { cookie: adminCookie } = await signIn(t.app, admin.email, admin.password)
  const employeeRole = await roleIdOf(t.deps, tenant.id, "employee")
  return { ...t, tenant, admin, adminCookie, employeeRole }
}
const tokenFrom = (m: { text: string }) => m.text.match(/\/invite\?token=([\w-]+)/)![1]

async function invite(w: Awaited<ReturnType<typeof world>>, email = "new@x.ie", roleId = w.employeeRole) {
  const r = await call(w.app, "POST", "/v1/invites", { cookie: w.adminCookie, tenant: w.tenant.slug, body: { email, roleId } })
  return r
}
async function newcomer(w: Awaited<ReturnType<typeof world>>, email = "new@x.ie") {
  await signUp(w.app, email, "Passw0rd!long", "New")
  return (await signIn(w.app, email, "Passw0rd!long")).cookie
}

test("invite emails a link; accepting adds membership with the invited role", async () => {
  const w = await world()
  const r = await invite(w)
  expect(r.status).toBe(201)
  const body = (await r.json()) as Json
  expect(body).toMatchObject({ email: "new@x.ie" })
  expect(JSON.stringify(body)).not.toMatch(/token/i)
  const mail = w.mailer.last()
  expect(mail.to).toBe("new@x.ie")
  const token = tokenFrom(mail)
  const cookie = await newcomer(w)
  const acc = await call(w.app, "POST", "/v1/invites/accept", { cookie, body: { token } })
  expect(acc.status).toBe(200)
  expect(await acc.json()).toMatchObject({ slug: "acme" })
  const rows = await ownerTenantQuery(w.tenant.id, "select m.role_id, m.status, u.email from memberships m join \"user\" u on u.id = m.user_id where u.email = 'new@x.ie'")
  expect(rows).toEqual([{ role_id: w.employeeRole, status: "active", email: "new@x.ie" }])
  const me = (await (await call(w.app, "GET", "/v1/me", { cookie })).json()) as Json
  expect(me.tenants).toEqual([{ slug: "acme", name: "acme", roleKey: "employee" }])
})

test("invite token is stored hashed (sha256), not in plain text, and is long", async () => {
  const w = await world()
  await invite(w)
  const token = tokenFrom(w.mailer.last())
  expect(token.length).toBeGreaterThanOrEqual(43)
  const [row] = await ownerTenantQuery(w.tenant.id, "select token_hash from invites")
  expect(row.token_hash).not.toBe(token)
  expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/)
  const { createHash } = await import("node:crypto")
  expect(row.token_hash).toBe(createHash("sha256").update(token).digest("hex"))
})

test("accepting an invite verifies the invited address", async () => {
  const w = await world()
  await invite(w)
  const token = tokenFrom(w.mailer.last())
  const cookie = await newcomer(w)
  // e.g. a social sign-in that never proved the address: the flag is false but the session is valid.
  await ownerQuery("update \"user\" set email_verified = false where email='new@x.ie'")
  expect((await call(w.app, "POST", "/v1/invites/accept", { cookie, body: { token } })).status).toBe(200)
  expect((await ownerQuery("select email_verified from \"user\" where email='new@x.ie'"))[0].email_verified).toBe(true)
})

test("a mismatched user does not get verified by someone else's invite", async () => {
  const w = await world()
  await invite(w)
  const token = tokenFrom(w.mailer.last())
  const cookie = await newcomer(w, "other@x.ie")
  await ownerQuery("update \"user\" set email_verified = false where email='other@x.ie'")
  await call(w.app, "POST", "/v1/invites/accept", { cookie, body: { token } })
  expect((await ownerQuery("select email_verified from \"user\" where email='other@x.ie'"))[0].email_verified).toBe(false)
})

test("expired invite is 410 invite_expired (7-day default TTL measured with the clock)", async () => {
  const w = await world()
  await invite(w)
  const token = tokenFrom(w.mailer.last())
  await signUp(w.app, "new@x.ie", "Passw0rd!long", "New")
  w.clock.advance({ days: 6 })
  const early = (await signIn(w.app, "new@x.ie", "Passw0rd!long")).cookie
  w.clock.advance({ days: 2 })
  // the 6-day-old session has idled out; a fresh sign-in is needed, then the 8-day-old invite is refused
  const cookie = (await signIn(w.app, "new@x.ie", "Passw0rd!long")).cookie
  expect(early).toBeTruthy()
  const r = await call(w.app, "POST", "/v1/invites/accept", { cookie, body: { token } })
  expect(r.status).toBe(410)
  expect(((await r.json()) as Json).code).toBe("invite_expired")
  expect(await ownerTenantQuery(w.tenant.id, "select 1 from memberships m join \"user\" u on u.id=m.user_id where u.email='new@x.ie'")).toEqual([])
})

test("an invite still works on day 6", async () => {
  const w = await world()
  await invite(w)
  const token = tokenFrom(w.mailer.last())
  await signUp(w.app, "new@x.ie", "Passw0rd!long", "New")
  w.clock.advance({ days: 6 })
  const cookie = (await signIn(w.app, "new@x.ie", "Passw0rd!long")).cookie
  expect((await call(w.app, "POST", "/v1/invites/accept", { cookie, body: { token } })).status).toBe(200)
})

test("invite_ttl_days tenant setting overrides the 7-day default", async () => {
  const w = await world()
  await ownerTenantQuery(w.tenant.id, "insert into tenant_settings (tenant_id, key, value) values ($1, 'invite_ttl_days', '1')", [w.tenant.id])
  await invite(w)
  const [row] = await ownerTenantQuery(w.tenant.id, "select created_at, expires_at from invites")
  expect((row.expires_at as Date).getTime() - (row.created_at as Date).getTime()).toBe(24 * 3600_000)
})

test("invite cannot be accepted by a user with another email (403 invite_email_mismatch)", async () => {
  const w = await world()
  await invite(w)
  const token = tokenFrom(w.mailer.last())
  const cookie = await newcomer(w, "other@x.ie")
  const r = await call(w.app, "POST", "/v1/invites/accept", { cookie, body: { token } })
  expect(r.status).toBe(403)
  expect(((await r.json()) as Json).code).toBe("invite_email_mismatch")
})

test("an invite is single use", async () => {
  const w = await world()
  await invite(w)
  const token = tokenFrom(w.mailer.last())
  const cookie = await newcomer(w)
  expect((await call(w.app, "POST", "/v1/invites/accept", { cookie, body: { token } })).status).toBe(200)
  const again = await call(w.app, "POST", "/v1/invites/accept", { cookie, body: { token } })
  expect(again.status).toBe(409)
  expect(((await again.json()) as Json).code).toBe("invite_used")
})

test("unknown or malformed token is 404; accepting needs a session", async () => {
  const w = await world()
  const cookie = await newcomer(w)
  for (const token of ["nope", "0".repeat(32) + "x".repeat(43), w.tenant.id.replaceAll("-", "") + "x".repeat(43)]) {
    expect((await call(w.app, "POST", "/v1/invites/accept", { cookie, body: { token } })).status).toBe(404)
  }
  expect((await call(w.app, "POST", "/v1/invites/accept", { body: { token: "abc" } })).status).toBe(401)
})

test("invite.created and member.joined are audited", async () => {
  const w = await world()
  await invite(w)
  const token = tokenFrom(w.mailer.last())
  const cookie = await newcomer(w)
  await call(w.app, "POST", "/v1/invites/accept", { cookie, body: { token } })
  const rows = await ownerTenantQuery(w.tenant.id, "select action, actor_id from audit_events order by seq")
  expect(rows.map((r) => r.action)).toEqual(["invite.created", "member.joined"])
  expect(rows[0].actor_id).toBe(w.admin.userId)
  const dump = JSON.stringify(await ownerTenantQuery(w.tenant.id, "select before, after from audit_events"))
  expect(dump).not.toContain(token)
})

test("only members who may manage settings can invite; other roles of other tenants are 404", async () => {
  const w = await world()
  const emp = await makeMember(w.deps, w.tenant.id, "employee")
  const { cookie } = await signIn(w.app, emp.email, emp.password)
  const r = await call(w.app, "POST", "/v1/invites", { cookie, tenant: "acme", body: { email: "z@x.ie", roleId: w.employeeRole } })
  expect(r.status).toBe(403)
  const other = await makeTenant(w.deps)
  const foreignRole = await roleIdOf(w.deps, other.id, "employee")
  expect((await invite(w, "z@x.ie", foreignRole)).status).toBe(404)
  expect((await call(w.app, "POST", "/v1/invites", { tenant: "acme", body: { email: "z@x.ie", roleId: w.employeeRole } })).status).toBe(401)
})

test("owner role cannot be granted by invite; bad body is 400", async () => {
  const w = await world()
  const ownerRole = await roleIdOf(w.deps, w.tenant.id, "owner")
  const r = await invite(w, "o@x.ie", ownerRole)
  expect(r.status).toBe(422)
  expect(((await r.json()) as Json).code).toBe("role_not_invitable")
  expect((await invite(w, "not-an-email")).status).toBe(400)
})

test("inviting someone who is already a member is 409", async () => {
  const w = await world()
  const m = await makeMember(w.deps, w.tenant.id, "employee")
  const r = await invite(w, m.email)
  expect(r.status).toBe(409)
  expect(((await r.json()) as Json).code).toBe("already_member")
})

test("an inviter cannot invite with a role above their own access (403 role_escalation)", async () => {
  const w = await world()
  const adm = await makeMember(w.deps, w.tenant.id, "admin") // tasks:read; employee has tasks:write, manager too
  const { cookie } = await signIn(w.app, adm.email, adm.password)
  const as = (roleId: string, email: string) => call(w.app, "POST", "/v1/invites", { cookie, tenant: "acme", body: { email, roleId } })
  const r = await as(w.employeeRole, "e@x.ie")
  expect(r.status).toBe(403)
  expect(((await r.json()) as Json).code).toBe("role_escalation")
  expect((await as(await roleIdOf(w.deps, w.tenant.id, "manager"), "m@x.ie")).status).toBe(403)
  expect((await as(await roleIdOf(w.deps, w.tenant.id, "owner"), "o@x.ie")).status).toBe(422) // never invitable
  expect((await as(await roleIdOf(w.deps, w.tenant.id, "admin"), "a@x.ie")).status).toBe(201) // equal access is allowed
  expect(await ownerTenantQuery(w.tenant.id, "select 1 from invites where email in ('e@x.ie','m@x.ie')")).toEqual([])
})

test("two different invites for the same user accepted at once: one 200, the other 409 (never 500)", async () => {
  const w = await world()
  await invite(w, "new@x.ie")
  const t1 = tokenFrom(w.mailer.last())
  await invite(w, "new@x.ie", await roleIdOf(w.deps, w.tenant.id, "supervisor"))
  const t2 = tokenFrom(w.mailer.last())
  const cookie = await newcomer(w)
  const rs = await Promise.all([t1, t2].map((token) => call(w.app, "POST", "/v1/invites/accept", { cookie, body: { token } })))
  expect(rs.map((r) => r.status).sort()).toEqual([200, 409])
  const bad = rs.find((r) => r.status === 409)!
  expect(((await bad.json()) as Json).code).toBe("already_member")
  expect((await ownerTenantQuery(w.tenant.id, "select 1 from memberships m join \"user\" u on u.id=m.user_id where u.email='new@x.ie'")).length).toBe(1)
})
