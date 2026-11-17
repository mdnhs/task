import { beforeEach, expect, test } from "vitest"
import { call, resetDb, testApp } from "../../../test/harness"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { makeMember, makeTenant, roleIdOf, signIn, signUp } from "../../../test/factories"

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
beforeEach(resetDb)

async function world() {
  const t = testApp()
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  const admin = await makeMember(t.deps, tenant.id, "admin")
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

test("admin can invite an employee (operational access does not count as escalation)", async () => {
  const w = await world()
  expect((await invite(w, "e@x.ie")).status).toBe(201) // employee has tasks:write, admin only tasks:read
  expect((await invite(w, "m@x.ie", await roleIdOf(w.deps, w.tenant.id, "manager"))).status).toBe(201)
})

test("an inviter cannot hand out administrative access above their own (403 role_escalation); owner is never invitable", async () => {
  const w = await world()
  // custom actor: may manage settings but holds no audit access
  await ownerTenantQuery(
    w.tenant.id,
    "insert into roles (tenant_id, key, label, home, access) select tenant_id, 'limited', 'Limited', home, access || '{\"audit\":\"none\"}'::jsonb from roles where key='admin'",
  )
  const lim = await makeMember(w.deps, w.tenant.id, "limited")
  const { cookie } = await signIn(w.app, lim.email, lim.password)
  const as = (roleId: string, email: string) => call(w.app, "POST", "/v1/invites", { cookie, tenant: "acme", body: { email, roleId } })
  const r = await as(await roleIdOf(w.deps, w.tenant.id, "manager"), "m@x.ie") // manager audit:write > none
  expect(r.status).toBe(403)
  expect(((await r.json()) as Json).code).toBe("role_escalation")
  expect((await as(w.employeeRole, "e@x.ie")).status).toBe(201)
  expect((await as(await roleIdOf(w.deps, w.tenant.id, "owner"), "o@x.ie")).status).toBe(422)
  expect(await ownerTenantQuery(w.tenant.id, "select 1 from invites where email='m@x.ie'")).toEqual([])
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

test("M5: accepting an invite of a suspended tenant is 404 invite_not_found and writes nothing; works again after reactivation", async () => {
  const w = await world()
  await invite(w)
  const token = tokenFrom(w.mailer.last())
  const cookie = await newcomer(w)
  await ownerQuery("update tenants set status = 'suspended' where id = $1", [w.tenant.id])
  const r = await call(w.app, "POST", "/v1/invites/accept", { cookie, body: { token } })
  expect(r.status).toBe(404)
  expect(((await r.json()) as Json).code).toBe("invite_not_found")
  expect((await ownerTenantQuery(w.tenant.id, "select accepted_at from invites"))[0].accepted_at).toBeNull()
  expect(await ownerTenantQuery(w.tenant.id, "select 1 from memberships where user_id in (select id from \"user\" where email = 'new@x.ie')")).toEqual([])
  await ownerQuery("update tenants set status = 'active' where id = $1", [w.tenant.id])
  expect((await call(w.app, "POST", "/v1/invites/accept", { cookie, body: { token } })).status).toBe(200)
})

// ---------------------------------------------------------------- B6 T6.5: list, revoke, resend, accept re-validation

const as = (w: Awaited<ReturnType<typeof world>>, method: string, path: string, body?: unknown, cookie = w.adminCookie) => call(w.app, method, path, { cookie, tenant: "acme", body })
const inviteMails = (w: Awaited<ReturnType<typeof world>>) => w.mailer.sent.filter((m) => /\/invite\?token=/.test(m.text))
const noSecrets = (text: string, ...tokens: string[]) => {
  expect(text).not.toMatch(/token/i)
  for (const t of tokens) expect(text).not.toContain(t)
}

test("GET /v1/invites lists unaccepted invites (settings:write only), newest first, with no token or hash", async () => {
  const w = await world()
  await invite(w, "a@x.ie")
  const tokenA = tokenFrom(w.mailer.last())
  w.clock.advance({ minutes: 5 })
  await invite(w, "b@x.ie", await roleIdOf(w.deps, w.tenant.id, "manager"))
  const r = await as(w, "GET", "/v1/invites")
  expect(r.status).toBe(200)
  const text = await r.text()
  noSecrets(text, tokenA)
  expect(text).not.toMatch(/hash/i)
  const body = JSON.parse(text) as Json
  expect(body.items.map((i: Json) => [i.email, i.roleKey])).toEqual([["b@x.ie", "manager"], ["a@x.ie", "employee"]])
  expect(Object.keys(body.items[0]).sort()).toEqual(["createdAt", "email", "expiresAt", "id", "invitedBy", "roleKey"])
  expect(body.items[0].invitedBy).toBe(w.admin.userId)
  // an accepted invite is no longer pending
  const cookie = await newcomer(w, "a@x.ie")
  expect((await call(w.app, "POST", "/v1/invites/accept", { cookie, body: { token: tokenA } })).status).toBe(200)
  expect(((await (await as(w, "GET", "/v1/invites")).json()) as Json).items.map((i: Json) => i.email)).toEqual(["b@x.ie"])
  // staff cannot list, a session without a tenant cannot either
  const emp = await makeMember(w.deps, w.tenant.id, "employee")
  const ecookie = (await signIn(w.app, emp.email, emp.password)).cookie
  expect((await as(w, "GET", "/v1/invites", undefined, ecookie)).status).toBe(403)
  expect((await call(w.app, "GET", "/v1/invites", { tenant: "acme" })).status).toBe(401)
})

test("an invite of another tenant never shows in this tenant's list", async () => {
  const w = await world()
  const other = await makeTenant(w.deps, { slug: "other" })
  const o = await makeMember(w.deps, other.id, "admin")
  const oc = (await signIn(w.app, o.email, o.password)).cookie
  const r = await call(w.app, "POST", "/v1/invites", { cookie: oc, tenant: "other", body: { email: "x@y.ie", roleId: await roleIdOf(w.deps, other.id, "employee") } })
  expect(r.status).toBe(201)
  expect(((await (await as(w, "GET", "/v1/invites")).json()) as Json).items).toEqual([])
})

test("DELETE /v1/invites/{id} revokes: 204, audited invite.revoked (no token), the old token is 404, a second revoke is 404", async () => {
  const w = await world()
  const created = (await (await invite(w)).json()) as Json
  const token = tokenFrom(w.mailer.last())
  const del = await as(w, "DELETE", `/v1/invites/${created.id}`)
  expect(del.status).toBe(204)
  expect(await del.text()).toBe("")
  expect(await ownerTenantQuery(w.tenant.id, "select 1 from invites")).toEqual([])
  const cookie = await newcomer(w)
  const acc = await call(w.app, "POST", "/v1/invites/accept", { cookie, body: { token } })
  expect(acc.status).toBe(404)
  expect(((await acc.json()) as Json).code).toBe("invite_not_found")
  expect((await as(w, "DELETE", `/v1/invites/${created.id}`)).status).toBe(404)
  const audit = await ownerTenantQuery(w.tenant.id, "select action, entity, entity_id, actor_id, before, after from audit_events where action = 'invite.revoked'")
  expect(audit).toHaveLength(1)
  expect(audit[0]).toMatchObject({ entity: "invite", entity_id: created.id, actor_id: w.admin.userId })
  const dump = JSON.stringify(await ownerTenantQuery(w.tenant.id, "select before, after from audit_events"))
  expect(dump).not.toContain(token)
  expect(dump).not.toContain("new@x.ie") // the address is only ever HMAC'd in the audit trail
})

test("revoke: staff 403, an accepted invite is 409 invite_used, another tenant's id is 404", async () => {
  const w = await world()
  const created = (await (await invite(w)).json()) as Json
  const token = tokenFrom(inviteMails(w).at(-1)!)
  const emp = await makeMember(w.deps, w.tenant.id, "employee")
  const ecookie = (await signIn(w.app, emp.email, emp.password)).cookie
  expect((await as(w, "DELETE", `/v1/invites/${created.id}`, undefined, ecookie)).status).toBe(403)
  const cookie = await newcomer(w)
  expect((await call(w.app, "POST", "/v1/invites/accept", { cookie, body: { token } })).status).toBe(200)
  const used = await as(w, "DELETE", `/v1/invites/${created.id}`)
  expect(used.status).toBe(409)
  expect(((await used.json()) as Json).code).toBe("invite_used")
})

test("resend rotates the token and sends exactly one mail; the old token stops working, the new one accepts; expiry restarts; audited without a token", async () => {
  const w = await world()
  const created = (await (await invite(w)).json()) as Json
  const oldToken = tokenFrom(w.mailer.last())
  expect(inviteMails(w)).toHaveLength(1)
  // a quick second send is refused (mail flood guard) and sends nothing
  const early = await as(w, "POST", `/v1/invites/${created.id}/resend`)
  expect(early.status).toBe(429)
  expect(((await early.json()) as Json).code).toBe("resend_too_soon")
  expect(inviteMails(w)).toHaveLength(1)
  w.clock.advance({ minutes: 90 })
  const r = await as(w, "POST", `/v1/invites/${created.id}/resend`)
  expect(r.status).toBe(200)
  const text = await r.text()
  noSecrets(text, oldToken)
  const body = JSON.parse(text) as Json
  expect(body).toMatchObject({ id: created.id, email: "new@x.ie" })
  expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(new Date(created.expiresAt).getTime()) // the 7 days restart
  expect(inviteMails(w)).toHaveLength(2)
  const newToken = tokenFrom(inviteMails(w).at(-1)!)
  expect(newToken).not.toBe(oldToken)
  expect(inviteMails(w).at(-1)!.to).toBe("new@x.ie")
  const cookie = await newcomer(w)
  expect((await call(w.app, "POST", "/v1/invites/accept", { cookie, body: { token: oldToken } })).status).toBe(404)
  const [row] = await ownerTenantQuery(w.tenant.id, "select token_hash from invites")
  const { createHash } = await import("node:crypto")
  expect(row.token_hash).toBe(createHash("sha256").update(newToken).digest("hex")) // only the hash is stored
  expect((await call(w.app, "POST", "/v1/invites/accept", { cookie, body: { token: newToken } })).status).toBe(200)
  const audit = await ownerTenantQuery(w.tenant.id, "select action, actor_id, before, after from audit_events where action = 'invite.resent'")
  expect(audit).toHaveLength(1)
  const dump = JSON.stringify(await ownerTenantQuery(w.tenant.id, "select before, after from audit_events"))
  for (const t of [oldToken, newToken]) expect(dump).not.toContain(t)
})

test("resend: an accepted invite is 409, staff 403, another tenant's id 404", async () => {
  const w = await world()
  const created = (await (await invite(w)).json()) as Json
  const token = tokenFrom(inviteMails(w).at(-1)!)
  const emp = await makeMember(w.deps, w.tenant.id, "employee")
  const ecookie = (await signIn(w.app, emp.email, emp.password)).cookie
  expect((await as(w, "POST", `/v1/invites/${created.id}/resend`, undefined, ecookie)).status).toBe(403)
  const cookie = await newcomer(w)
  await call(w.app, "POST", "/v1/invites/accept", { cookie, body: { token } })
  w.clock.advance({ minutes: 5 })
  const used = await as(w, "POST", `/v1/invites/${created.id}/resend`)
  expect(used.status).toBe(409)
  expect(((await used.json()) as Json).code).toBe("invite_used")
  expect((await as(w, "POST", "/v1/invites/00000000-0000-4000-8000-000000000000/resend")).status).toBe(404)
})

test("resend is judged on the invited role and the resender (R24): a limited admin cannot re-send an invite for a role above their own access", async () => {
  const w = await world()
  const created = (await (await invite(w, "m@x.ie", await roleIdOf(w.deps, w.tenant.id, "manager"))).json()) as Json
  await ownerTenantQuery(w.tenant.id, "insert into roles (tenant_id, key, label, home, access) select tenant_id, 'limited', 'Limited', home, access || '{\"audit\":\"none\"}'::jsonb from roles where key='admin'")
  const lim = await makeMember(w.deps, w.tenant.id, "limited")
  const lc = (await signIn(w.app, lim.email, lim.password)).cookie
  w.clock.advance({ minutes: 5 })
  const r = await as(w, "POST", `/v1/invites/${created.id}/resend`, undefined, lc)
  expect(r.status).toBe(403)
  expect(((await r.json()) as Json).code).toBe("role_escalation")
  expect(inviteMails(w)).toHaveLength(1) // nothing was sent
  // an admin can: the resender becomes the inviter of record
  const ok = await as(w, "POST", `/v1/invites/${created.id}/resend`)
  expect(ok.status).toBe(200)
  expect((await ownerTenantQuery(w.tenant.id, "select invited_by from invites"))[0].invited_by).toBe(w.admin.userId)
})

test("accept re-validates the inviter: a demoted, suspended or removed inviter's invite is refused (410 invite_invalid) and writes nothing", async () => {
  for (const how of ["demoted", "suspended", "removed"] as const) {
    await resetDb()
    const w = await world()
    await invite(w)
    const token = tokenFrom(w.mailer.last())
    const cookie = await newcomer(w)
    if (how === "demoted") await ownerTenantQuery(w.tenant.id, "update memberships set role_id = (select id from roles where key = 'employee' and tenant_id = $1) where user_id = $2", [w.tenant.id, w.admin.userId])
    if (how === "suspended") await ownerTenantQuery(w.tenant.id, "update memberships set status = 'suspended' where user_id = $1", [w.admin.userId])
    if (how === "removed") await ownerTenantQuery(w.tenant.id, "delete from memberships where user_id = $1", [w.admin.userId])
    const r = await call(w.app, "POST", "/v1/invites/accept", { cookie, body: { token } })
    expect(r.status, how).toBe(410)
    expect(((await r.json()) as Json).code, how).toBe("invite_invalid")
    expect((await ownerTenantQuery(w.tenant.id, "select accepted_at from invites"))[0].accepted_at, how).toBeNull()
    expect(await ownerTenantQuery(w.tenant.id, "select 1 from memberships m join \"user\" u on u.id = m.user_id where u.email = 'new@x.ie'"), how).toEqual([])
  }
})

test("accept re-validates the invited role against the inviter's CURRENT access (R24): shrinking the inviter's role after inviting refuses the invite", async () => {
  const w = await world()
  await invite(w, "new@x.ie", await roleIdOf(w.deps, w.tenant.id, "manager")) // manager: audit write
  const token = tokenFrom(w.mailer.last())
  const cookie = await newcomer(w)
  // the inviter moves to a role that still manages settings but holds no audit access
  await ownerTenantQuery(w.tenant.id, "insert into roles (tenant_id, key, label, home, access) select tenant_id, 'limited', 'Limited', home, access || '{\"audit\":\"none\"}'::jsonb from roles where key='admin'")
  await ownerTenantQuery(w.tenant.id, "update memberships set role_id = (select id from roles where key = 'limited' and tenant_id = $1) where user_id = $2", [w.tenant.id, w.admin.userId])
  const r = await call(w.app, "POST", "/v1/invites/accept", { cookie, body: { token } })
  expect(r.status).toBe(410)
  expect(((await r.json()) as Json).code).toBe("invite_invalid")
  // an invite for a role within the inviter's access still works
  const me = await ownerTenantQuery(w.tenant.id, "select 1")
  expect(me).toHaveLength(1)
})

test("a still-valid inviter's invite is accepted as before (the re-validation does not break the happy path); the checks keep their old order", async () => {
  const w = await world()
  await invite(w)
  const token = tokenFrom(w.mailer.last())
  const wrong = await newcomer(w, "other@x.ie")
  const r = await call(w.app, "POST", "/v1/invites/accept", { cookie: wrong, body: { token } })
  expect(((await r.json()) as Json).code).toBe("invite_email_mismatch") // before the inviter check
  const cookie = await newcomer(w)
  expect((await call(w.app, "POST", "/v1/invites/accept", { cookie, body: { token } })).status).toBe(200)
})

test("the new invite routes are covered by the API-key deny-list prefix (/v1/invites)", async () => {
  const { API_KEY_DENIED_ROUTES } = await import("../../core/middleware/api-key")
  expect(API_KEY_DENIED_ROUTES.some((r) => "prefix" in r && r.prefix === "/v1/invites")).toBe(true) // prefix: covers the list, revoke and resend
})

// ---------------------------------------------------------------- T6.5 fix round 1: support sessions and races

test("a support session (read-only, under a grant) is refused on GET /v1/invites and on every invite write", async () => {
  const { makeStaff } = await import("../../../test/factories")
  const w = await world()
  const created = (await (await invite(w)).json()) as Json
  const staff = await makeStaff(w.deps, "support")
  const g = await call(w.app, "POST", `/v1/platform/tenants/${w.tenant.id}/support-grants`, { cookie: staff.cookie!, body: { reason: "Ticket 4411: invites look wrong", hours: 2 } })
  expect(g.status).toBe(201)
  const asSupport = (method: string, path: string, body?: unknown) => call(w.app, method, path, { cookie: staff.cookie!, tenant: "acme", body })
  for (const [m, p] of [["GET", "/v1/invites"], ["DELETE", `/v1/invites/${created.id}`], ["POST", `/v1/invites/${created.id}/resend`]] as const) {
    const r = await asSupport(m, p)
    expect(r.status, `${m} ${p}`).toBe(403)
    expect(await r.text()).not.toMatch(/new@x\.ie|token/i)
  }
  expect(await ownerTenantQuery(w.tenant.id, "select 1 from invites")).toHaveLength(1)
})

test("an accept racing a revoke or a resend: exactly one outcome, never a 500, and the final state agrees with the winner", async () => {
  for (const other of ["revoke", "resend"] as const) {
    await resetDb()
    const w = await world()
    const created = (await (await invite(w)).json()) as Json
    const token = tokenFrom(w.mailer.last())
    const cookie = await newcomer(w)
    w.clock.advance({ minutes: 5 }) // past the resend cooldown (the admin session stays valid)
    const [acc, act] = await Promise.all([
      call(w.app, "POST", "/v1/invites/accept", { cookie, body: { token } }),
      other === "revoke" ? as(w, "DELETE", `/v1/invites/${created.id}`) : as(w, "POST", `/v1/invites/${created.id}/resend`),
    ])
    expect(acc.status, other).toBeLessThan(500)
    expect(act.status, other).toBeLessThan(500)
    const joined = (await ownerTenantQuery(w.tenant.id, "select 1 from memberships m join \"user\" u on u.id = m.user_id where u.email = 'new@x.ie'")).length
    if (acc.status === 200) {
      expect(joined, other).toBe(1)
      expect(act.status, `${other} after the accept`).toBe(409) // invite_used
    } else {
      expect(joined, other).toBe(0)
      expect([404, 409], `accept lost to ${other}`).toContain(acc.status)
      expect(act.status).toBeLessThan(300)
    }
  }
})
