import { beforeEach, afterEach, expect, test } from "vitest"
import pino from "pino"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { call, resetDb, testApp } from "../../../test/harness"
import { fakeClock } from "../../../test/fakes"
import { makeMember, makeTenant, roleIdOf, signIn } from "../../../test/factories"
import { publish, relayOnce, resetSubscribers } from "../../core/events"
import { runJob } from "../../core/queue/queue"
import { withTenant } from "../../db/tenant-tx"
import { notify, registerNotifications, withTenantAfterCommit } from "../notifications"
import { registerSearchIndexers } from "../search"
import { registerFiles } from "../files"
import { verifyChain } from "../audit"
import { registerDsrHandler, registerGdpr, scrubPayload } from "."
import { resetDsrHandlers } from "./registry"

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const REASON = "Reason-Sentinel-7731 she phoned us"
let logs: string[] = []

beforeEach(async () => {
  await resetDb()
  resetSubscribers()
  resetDsrHandlers()
  logs = []
  registerNotifications()
  registerSearchIndexers()
  registerFiles()
  registerGdpr()
})
afterEach(() => {
  resetSubscribers()
  resetDsrHandlers()
})

const q = <R = Record<string, unknown>>(tenant: string, sql: string, params: unknown[] = []) => ownerTenantQuery(tenant, sql, params) as Promise<R[]>

async function world(over: Parameters<typeof testApp>[0] = {}) {
  const logger = pino({ level: "debug" }, { write: (s: string) => void logs.push(s) } as never)
  const t = testApp({ logger, ...over })
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  const owner = await makeMember(t.deps, tenant.id, "owner")
  const admin = await makeMember(t.deps, tenant.id, "admin") // settings:write
  const mary = await makeMember(t.deps, tenant.id, "employee") // the data subject; files: none
  const other = await makeMember(t.deps, tenant.id, "employee")
  const hr = await makeMember(t.deps, tenant.id, "hr") // files:write, no settings
  await ownerQuery(`update "user" set name = $1 where id = $2`, ["Mary Byrne", mary.userId])
  await ownerQuery(`update "user" set name = $1 where id = $2`, ["Olive Owner", owner.userId])
  const login = async (m: { email: string; password: string }) => (await signIn(t.app, m.email, m.password)).cookie
  const c = { owner: await login(owner), admin: await login(admin), mary: await login(mary), other: await login(other), hr: await login(hr) }
  const req = (method: string, path: string, cookie: string, body?: unknown, slug = tenant.slug) => call(t.app, method, path, { cookie, tenant: slug, body })
  const jobs = async (names: string[] = ["dsr.export", "dsr.erase", "notification.send", "file.delete-object"]) => {
    for (let i = 0; i < 5; i++) {
      const run = t.queue.jobs.filter((j) => names.includes(j.name))
      if (run.length === 0) return
      for (const j of run) {
        t.queue.jobs.splice(t.queue.jobs.indexOf(j), 1)
        await runJob(j.name, j.data, t.deps)
      }
    }
  }
  const relay = async () => {
    for (let i = 0; i < 5 && (await relayOnce(t.deps)) > 0; i++);
  }
  const open = async (as: keyof typeof c, subject: string, kind: string, reason = REASON) => {
    const r = await req("POST", "/v1/data-requests", c[as], { subjectUserId: subject, kind, reason })
    return { status: r.status, body: (await r.json()) as Json }
  }
  const get = async (id: string) => ((await (await req("GET", `/v1/data-requests/${id}`, c.admin)).json()) as Json)
  return { ...t, logger, tenant, owner, admin, mary, other, hr, c, req, jobs, relay, open, get }
}
type W = Awaited<ReturnType<typeof world>>

/** Everything personal about Mary in this tenant: notification, push token, device, team + manager, file, invite, integration, search doc, event. */
async function seedMary(w: W) {
  const tid = w.tenant.id
  const m = w.mary.userId
  expect((await w.req("POST", "/v1/me/push-tokens", w.c.mary, { token: "fcm-token-for-mary-xxxxxxxx", platform: "android" })).status).toBe(201)
  await withTenantAfterCommit(w.deps, tid, (tx, enqueue) => notify(tx, tid, { userId: m, kind: "system", title: "Rota changed", body: "Olive Owner moved your shift" }, w.deps, enqueue)) // push delivery row exists
  expect((await w.req("POST", "/v1/devices", w.c.owner, { userId: m, type: "pc", owner: "company", label: "Mary laptop", trusted: true })).status).toBe(201)
  const team = (await (await w.req("POST", "/v1/teams", w.c.owner, { name: "Kitchen", kind: "team" })).json()) as Json
  expect((await w.req("PUT", `/v1/teams/${team.id}/members`, w.c.owner, { userIds: [m, w.other.userId] })).status).toBe(200)
  expect((await w.req("PUT", `/v1/members/${m}/manager`, w.c.owner, { managerId: w.owner.userId })).status).toBe(200)
  expect((await w.req("PUT", `/v1/members/${w.other.userId}/manager`, w.c.owner, { managerId: m })).status).toBe(200) // Mary manages someone
  const fileId = crypto.randomUUID()
  await q(tid, `insert into files (id, tenant_id, owner_user_id, key, name, mime, size_bytes, status, created_at) values ($1::uuid, $2::uuid, $3, 't/' || $2::text || '/' || $1::text, 'rota.pdf', 'application/pdf', 10, 'pending', now())`, [fileId, tid, m])
  const [role] = await q(tid, `select id from roles where tenant_id = $1 and key = 'employee'`, [tid])
  await q(tid, `insert into invites (tenant_id, email, role_id, token_hash, invited_by, created_at, expires_at) values ($1, $2, $3, 'h-mary', $4, now(), now() + interval '1 day')`, [tid, w.mary.email, role.id, w.owner.userId])
  await q(tid, `insert into integration_connections (tenant_id, provider, status, scopes, account_email, token_ciphertext, connected_by, connected_at) values ($1, 'google', 'connected', array['openid'], 'mary@gmail.test', 'v2:junk', $2, now())`, [tid, m])
  await withTenant(w.deps.db, tid, async (tx) => {
    await publish(tx, { tenantId: tid, type: "member.joined", payload: { userId: m }, actorId: m }, w.deps.clock.now())
    await publish(tx, { tenantId: tid, type: "invite.created", payload: { inviteId: crypto.randomUUID(), email: w.mary.email, roleKey: "employee", invitee: "Mary Byrne" }, actorId: w.owner.userId }, w.deps.clock.now())
  })
  await w.relay()
  return { teamId: team.id as string, fileId }
}

const content = async (w: W, fileId: string, cookie: string): Promise<{ status: number; text?: string }> => {
  const r = await w.req("GET", `/v1/files/${fileId}/download`, cookie)
  if (r.status !== 302) return { status: r.status }
  const res = await fetch(r.headers.get("location")!)
  return { status: 302, text: await res.text() }
}

test("export bundles every registered handler and is downloadable only by the requester and settings:write", async () => {
  const w = await world()
  await seedMary(w)
  registerDsrHandler("tasks", { export: async (_tx, _t, userId) => ({ assigned: 3, userId }), erase: async () => {} })
  const r = await w.req("POST", "/v1/me/data-export", w.c.mary)
  expect(r.status).toBe(201)
  const created = (await r.json()) as Json
  expect(created).toMatchObject({ kind: "export", status: "pending", subjectUserId: w.mary.userId, requestedBy: w.mary.userId })
  expect(w.queue.jobs.find((j) => j.name === "dsr.export")).toBeTruthy()
  await w.jobs()
  const done = await w.get(created.id)
  expect(done).toMatchObject({ status: "completed", errorCode: null })
  expect(done.resultFileId).toBeTruthy()

  const meta = (await (await w.req("GET", `/v1/files/${done.resultFileId}`, w.c.mary)).json()) as Json
  expect(meta).toMatchObject({ name: `dsr-export-${created.id}.json`, mime: "application/json", status: "clean", ownerUserId: w.mary.userId })

  // only the requester (even without files access) and settings:write users; everyone else gets 404, hr (files:write) too
  const own = await content(w, done.resultFileId, w.c.mary)
  expect(own.status).toBe(302)
  expect((await content(w, done.resultFileId, w.c.admin)).status).toBe(302)
  expect((await content(w, done.resultFileId, w.c.owner)).status).toBe(302)
  for (const who of [w.c.other, w.c.hr]) {
    expect((await w.req("GET", `/v1/files/${done.resultFileId}/download`, who)).status).toBe(404)
    expect((await w.req("GET", `/v1/files/${done.resultFileId}`, who)).status).toBe(404)
  }
  expect((await w.req("DELETE", `/v1/files/${done.resultFileId}`, w.c.hr)).status).toBe(404)

  const bundle = JSON.parse(own.text!) as Json
  expect(bundle).toMatchObject({ schema: "opsdesk.dsr-export/1", requestId: created.id, tenantId: w.tenant.id, subjectUserId: w.mary.userId })
  expect(Object.keys(bundle.modules).sort()).toEqual(["audit", "devices", "events", "files", "identity", "integrations", "invites", "notifications", "search", "tasks", "teams"])
  expect(bundle.modules.tasks).toEqual({ assigned: 3, userId: w.mary.userId })
  expect(bundle.modules.identity).toMatchObject({ profile: { name: "Mary Byrne", email: w.mary.email }, membership: { roleKey: "employee" } })
  expect(bundle.modules.teams).toMatchObject({ managerId: w.owner.userId, directReportIds: [w.other.userId] })
  expect(bundle.modules.notifications.notifications.map((n: Json) => n.title)).toContain("Rota changed")
  expect(bundle.modules.devices.devices).toHaveLength(1)
  expect(bundle.modules.files.files).toHaveLength(1)
  // nothing about other people and no secrets: no one else's name/email, no notification bodies, no token, no hashes
  for (const secret of [w.owner.email, w.other.email, w.admin.email, "Olive Owner", "moved your shift", "fcm-token-for-mary", "token_hash", "enrolHash", "v2:junk"]) expect(own.text, secret).not.toContain(secret)

  // the requester was told, the export is audited, and the expiry job is scheduled 30 days out
  const notes = await q(w.tenant.id, `select title, link from notifications where user_id = $1 and kind = 'dsr'`, [w.mary.userId])
  expect(notes).toEqual([{ title: "Your data export is ready", link: `/v1/files/${done.resultFileId}/download` }])
  const audit = await q(w.tenant.id, `select action from audit_events where entity = 'data_request' order by seq`)
  expect(audit.map((a) => a.action)).toEqual(["dsr.requested", "dsr.export_completed"])
  const expire = w.queue.jobs.find((j) => j.name === "dsr.export-expire")!
  expect(expire.opts?.delayMs).toBe(30 * 24 * 3600 * 1000)
})

test("export of the file expires: the 30-day job deletes the file and its object, re-run is a no-op", async () => {
  const w = await world()
  const created = (await (await w.req("POST", "/v1/me/data-export", w.c.mary)).json()) as Json
  await w.jobs()
  const fileId = (await w.get(created.id)).resultFileId as string
  const key = `t/${w.tenant.id}/${fileId}`
  expect(await w.deps.storage.head(key)).not.toBeNull()
  const expire = w.queue.jobs.find((j) => j.name === "dsr.export-expire")!
  await runJob(expire.name, expire.data, w.deps)
  await runJob(expire.name, expire.data, w.deps) // idempotent
  await w.jobs()
  expect((await q(w.tenant.id, `select status from files where id = $1`, [fileId]))[0].status).toBe("deleted")
  expect(await w.deps.storage.head(key)).toBeNull()
  expect((await w.req("GET", `/v1/files/${fileId}/download`, w.c.mary)).status).toBe(404)
  expect((await q(w.tenant.id, `select count(*)::int as n from audit_events where action = 'dsr.export_expired'`))[0].n).toBe(1)
})

test("erase anonymises and keeps the audit chain valid", async () => {
  const w = await world()
  const { fileId } = await seedMary(w)
  expect((await w.req("GET", `/v1/search?q=Mary`, w.c.owner)).status).toBe(200)
  const hitsBefore = ((await (await w.req("GET", "/v1/search?q=Byrne", w.c.owner)).json()) as Json).hits as Json[]
  expect(hitsBefore.map((h) => h.title)).toEqual(["Mary Byrne"])
  const maryNotes = (await q(w.tenant.id, `select id from notifications where user_id = $1`, [w.mary.userId])).map((x) => x.id)
  expect(Number((await q(w.tenant.id, `select count(*) n from notification_deliveries where notification_id = any($1::uuid[])`, [maryNotes]))[0].n)).toBeGreaterThan(0)
  const before = await q(w.tenant.id, `select seq, hash, before, after from audit_events order by seq`)
  expect(await verifyChain(w.deps.db, w.tenant.id)).toMatchObject({ ok: true })
  const exp1 = await w.open("admin", w.mary.userId, "export") // an export ABOUT Mary exists too
  await w.jobs()
  const expFile = (await w.get(exp1.body.id)).resultFileId as string

  const r = await w.open("owner", w.mary.userId, "erase")
  expect(r.status).toBe(201)
  await w.jobs()
  await w.relay()
  const done = await w.get(r.body.id)
  expect(done).toMatchObject({ status: "completed", errorCode: null })

  // audit rows that existed before are byte-identical, the chain still verifies, new entries are ids/codes only
  const after = await q(w.tenant.id, `select seq, hash, before, after from audit_events order by seq`)
  expect(after.slice(0, before.length)).toEqual(before)
  expect(await verifyChain(w.deps.db, w.tenant.id)).toMatchObject({ ok: true })
  const acts = (await q(w.tenant.id, `select action from audit_events where seq > $1 order by seq`, [before.length])).map((a) => a.action)
  expect(acts).toEqual(expect.arrayContaining(["dsr.requested", "dsr.erasure_completed", "member.removed"]))

  // nobody can find her any more
  const search = ((await (await w.req("GET", "/v1/search?q=Byrne", w.c.owner)).json()) as Json).hits as Json[]
  expect(search).toEqual([])
  expect(await q(w.tenant.id, `select 1 from search_documents where entity_id = $1 or entity_id = $2`, [w.mary.userId, fileId])).toEqual([])

  // per-table: personal rows gone, shared business records stay with the person link cut
  const t = w.tenant.id
  const m = w.mary.userId
  const n = async (sql: string, p: unknown[] = [m]) => Number((await q(t, sql, p))[0].n)
  expect(await n(`select count(*) n from memberships where user_id = $1`)).toBe(0)
  expect(await n(`select count(*) n from notifications where user_id = $1`)).toBe(0)
  expect(await n(`select count(*) n from notification_preferences where user_id = $1`)).toBe(0)
  expect(await n(`select count(*) n from push_tokens where user_id = $1`)).toBe(0)
  expect(await n(`select count(*) n from notification_deliveries where notification_id = any($1::uuid[])`, [maryNotes])).toBe(0)
  expect(await n(`select count(*) n from devices where user_id = $1`)).toBe(0)
  expect(await n(`select count(*) n from team_members where user_id = $1`)).toBe(0)
  expect(await n(`select count(*) n from reporting_lines where user_id = $1 or manager_id = $1`)).toBe(0)
  expect(await n(`select count(*) n from integration_connections where connected_by = $1`)).toBe(0)
  expect(await n(`select count(*) n from invites where lower(email) = lower($1)`, [w.mary.email])).toBe(0)
  expect(await q(t, `select owner_user_id, status from files where id = $1`, [fileId])).toEqual([{ owner_user_id: null, status: "pending" }])
  expect((await q(t, `select count(*)::int n from teams where name = 'Kitchen'`))[0].n).toBe(1) // the team itself stays
  // the export generated about her is deleted with her data; the request records stay but their free text is scrubbed
  expect((await q(t, `select status from files where id = $1`, [expFile]))[0].status).toBe("deleted")
  const reqs = await q(t, `select reason, notes from data_requests where subject_user_id = $1`, [m])
  expect(reqs.every((x) => x.reason === "[erased]")).toBe(true)
  // outbox payloads no longer carry her email or name; ids and types stay
  const events = await q(t, `select type, payload from domain_events where type = 'invite.created'`)
  expect(events).toHaveLength(1)
  expect(JSON.stringify(events[0].payload)).not.toContain(w.mary.email)
  expect(JSON.stringify(events[0].payload)).not.toContain("Mary Byrne")
  expect(events[0].payload).toMatchObject({ roleKey: "employee", email: "[erased]", invitee: "[erased]" })
  expect((await q(t, `select count(*)::int n from domain_events where type = 'member.removed' and payload->>'userId' = $1`, [m]))[0].n).toBe(1)

  // last membership: the global identity is anonymised and every credential is gone
  const [u] = (await ownerQuery(`select name, email, image, email_verified, two_factor_enabled from "user" where id = $1`, [m])) as Json[]
  expect(u.name).toBe("Erased user")
  expect(u.email).toMatch(/^erased\+[0-9a-f-]{36}@invalid$/)
  expect(u.image).toBeNull()
  for (const tbl of ["session", "account", "two_factor"]) expect((await ownerQuery(`select count(*)::int n from "${tbl}" where user_id = $1`, [m]))[0].n, tbl).toBe(0)
  expect((await w.req("GET", "/v1/me/data-export", w.c.mary)).status).toBe(401) // her session is gone
  expect(done.completedAt).toBeTruthy()
})

test("erase leaves the global identity alone when the person is still a member of another tenant", async () => {
  const w = await world()
  await seedMary(w)
  const beta = await makeTenant(w.deps, { slug: "beta" })
  const betaOwner = await makeMember(w.deps, beta.id, "owner")
  await makeMember(w.deps, beta.id, "employee", { email: w.mary.email }) // same Better Auth user
  const cb = (await signIn(w.app, betaOwner.email, betaOwner.password)).cookie

  const r = await w.open("owner", w.mary.userId, "erase")
  expect(r.status).toBe(201)
  await w.jobs()
  expect(await w.get(r.body.id)).toMatchObject({ status: "completed" })
  const [u] = (await ownerQuery(`select name, email from "user" where id = $1`, [w.mary.userId])) as Json[]
  expect(u).toEqual({ name: "Mary Byrne", email: w.mary.email }) // identity untouched
  expect((await ownerQuery(`select count(*)::int n from session where user_id = $1`, [w.mary.userId]))[0].n).toBeGreaterThan(0)
  expect(await q(beta.id, `select 1 from memberships where user_id = $1`, [w.mary.userId])).toHaveLength(1) // other tenant intact
  expect(await q(w.tenant.id, `select 1 from memberships where user_id = $1`, [w.mary.userId])).toHaveLength(0)

  // erasing her in the other (last) tenant now anonymises the identity
  const r2 = await call(w.app, "POST", "/v1/data-requests", { cookie: cb, tenant: "beta", body: { subjectUserId: w.mary.userId, kind: "erase", reason: "second" } })
  expect(r2.status).toBe(201)
  await w.jobs()
  expect((await ownerQuery(`select name from "user" where id = $1`, [w.mary.userId]))[0].name).toBe("Erased user")
  expect((await ownerQuery(`select count(*)::int n from session where user_id = $1`, [w.mary.userId]))[0].n).toBe(0)
})

test("erase of the last owner is rejected 409 last_owner (at request time and again in the job)", async () => {
  const w = await world()
  const r = await w.open("admin", w.owner.userId, "erase")
  expect(r.status).toBe(409)
  expect(r.body.code).toBe("last_owner")
  expect(await q(w.tenant.id, `select 1 from data_requests`)).toEqual([])

  // two owners: allowed
  const owner2 = await makeMember(w.deps, w.tenant.id, "owner")
  const r2 = await w.open("owner", owner2.userId, "erase")
  expect(r2.status).toBe(201)
})

test("a failing erase job on the last owner marks the request failed with last_owner and removes nothing", async () => {
  const w = await world()
  const owner2 = await makeMember(w.deps, w.tenant.id, "owner")
  const r = await w.open("owner", owner2.userId, "erase")
  expect(r.status).toBe(201)
  // make owner2 the last owner behind the API's back (the demotion of the first owner by SQL)
  const adminRole = await roleIdOf(w.deps, w.tenant.id, "admin")
  await q(w.tenant.id, `update memberships set role_id = $1 where user_id = $2`, [adminRole, w.owner.userId])
  await w.jobs()
  const got = await w.get(r.body.id)
  expect(got).toMatchObject({ status: "failed", errorCode: "last_owner" })
  expect(await q(w.tenant.id, `select 1 from memberships where user_id = $1`, [owner2.userId])).toHaveLength(1)
  expect((await q(w.tenant.id, `select action from audit_events where action = 'dsr.failed'`)).length).toBe(1)
})

test("subject from another tenant -> 404 member_not_found; plain members cannot use the admin routes", async () => {
  const w = await world()
  const beta = await makeTenant(w.deps, { slug: "beta" })
  const stranger = await makeMember(w.deps, beta.id, "employee")
  const r = await w.open("owner", stranger.userId, "export")
  expect(r.status).toBe(404)
  expect(r.body.code).toBe("member_not_found")
  expect((await w.open("owner", "usr_ghost", "erase")).status).toBe(404)
  expect(await q(w.tenant.id, `select 1 from data_requests`)).toEqual([])
  expect((await w.open("other", w.other.userId, "export")).status).toBe(403)
  expect((await w.req("GET", "/v1/data-requests", w.c.other)).status).toBe(403)
  // erase/correct of yourself needs someone else
  expect((await w.open("admin", w.admin.userId, "erase")).body.code).toBe("self_request_not_allowed")
  expect((await w.open("admin", w.admin.userId, "correct")).status).toBe(422)
  expect((await w.open("admin", w.admin.userId, "export")).status).toBe(201)
})

test("due_at = requested_at + 30 days in tenant time (DST aware); overdue requests are listed first", async () => {
  const w = await world({ clock: fakeClock(new Date("2026-10-10T12:00:00Z")) })
  // Europe/Dublin: BST (UTC+1) on 10 Oct, GMT from 25 Oct. 13:00 local + 30 calendar days = 13:00 local on 9 Nov = 13:00Z
  const a = await w.open("owner", w.mary.userId, "correct")
  expect(a.body.dueAt).toBe("2026-11-09T13:00:00.000Z")
  expect(a.body.createdAt).toBe("2026-10-10T12:00:00.000Z")
  await ownerQuery(`update tenants set timezone = 'Asia/Tokyo' where id = $1`, [w.tenant.id])
  const jp = await w.open("owner", w.mary.userId, "correct")
  expect(jp.body.dueAt).toBe("2026-11-09T12:00:00.000Z") // no DST in Tokyo: exactly 30 x 24 h
  await ownerQuery(`update tenants set timezone = 'Europe/Dublin' where id = $1`, [w.tenant.id])

  // ordering: A overdue, B open, C open later; D closed (completed) comes last although its due date is earliest
  w.clock.advance({ days: 20 })
  w.c.owner = (await signIn(w.app, w.owner.email, w.owner.password)).cookie
  const d = await w.open("owner", w.other.userId, "correct")
  const closed = (await (await w.req("POST", `/v1/data-requests/${a.body.id}/complete`, w.c.owner, { notes: "done" })).json()) as Json
  expect(closed.status).toBe("completed")
  w.clock.advance({ days: 20 }) // day 40: `jp` (due day 30) is overdue, `d` (due day 50) is not
  w.c.owner = (await signIn(w.app, w.owner.email, w.owner.password)).cookie
  const e = await w.open("owner", w.mary.userId, "correct")
  const list = (await (await w.req("GET", "/v1/data-requests", w.c.owner)).json()) as Json[]
  expect(list.map((x) => x.id)).toEqual([jp.body.id, d.body.id, e.body.id, a.body.id])
  expect(list.map((x) => x.overdue)).toEqual([true, false, false, false])
  expect(((await (await w.req("GET", "/v1/data-requests?status=completed", w.c.owner)).json()) as Json[]).map((x) => x.id)).toEqual([a.body.id])
})

test("every request and completion is audited; reasons are stored but never logged nor written to audit", async () => {
  const w = await world()
  const c1 = await w.open("owner", w.mary.userId, "correct")
  const c2 = await w.open("owner", w.other.userId, "correct")
  const rej = await w.req("POST", `/v1/data-requests/${c2.body.id}/reject`, w.c.owner, { notes: "Reject-Sentinel-5521 identity not verified" })
  expect(rej.status).toBe(200)
  expect(await rej.json()).toMatchObject({ status: "rejected", notes: "Reject-Sentinel-5521 identity not verified" })
  expect((await w.req("POST", `/v1/data-requests/${c2.body.id}/reject`, w.c.owner, { notes: "again" })).status).toBe(409)
  const ok = await w.req("POST", `/v1/data-requests/${c1.body.id}/complete`, w.c.owner, { notes: "Completed-Sentinel-1189 fixed spelling" })
  expect(ok.status).toBe(200)
  expect((await w.req("POST", `/v1/data-requests/${c1.body.id}/complete`, w.c.owner, { notes: "x" })).status).toBe(409) // already closed
  const exp = await w.open("admin", w.mary.userId, "export")
  expect((await w.req("POST", `/v1/data-requests/${exp.body.id}/complete`, w.c.owner, { notes: "x" })).status).toBe(409) // only corrections
  await w.jobs()
  const er = await w.open("owner", w.other.userId, "erase")
  await w.jobs()

  const audit = await q(w.tenant.id, `select action, actor_id, entity_id, before, after from audit_events where action like 'dsr.%' order by seq`)
  expect(audit.map((a) => a.action)).toEqual(["dsr.requested", "dsr.requested", "dsr.rejected", "dsr.completed", "dsr.requested", "dsr.export_completed", "dsr.requested", "dsr.erasure_completed"])
  const stored = await q(w.tenant.id, `select id, reason, notes from data_requests where id = $1`, [c1.body.id])
  expect(stored[0]).toMatchObject({ reason: REASON, notes: "Completed-Sentinel-1189 fixed spelling" })
  const everything = JSON.stringify(await q(w.tenant.id, `select * from audit_events`)) + JSON.stringify(await q(w.tenant.id, `select * from domain_events`)) + logs.join("\n")
  for (const s of ["Reason-Sentinel-7731", "Reject-Sentinel-5521", "Completed-Sentinel-1189"]) expect(everything, s).not.toContain(s)
  expect(er.status).toBe(201)
  expect(await q(w.tenant.id, `select type from domain_events where type like 'dsr.%' order by occurred_at, type`)).toEqual(expect.arrayContaining([{ type: "dsr.requested" }, { type: "dsr.completed" }]))
})

test("jobs are idempotent: re-running a finished export or erase changes nothing", async () => {
  const w = await world()
  await seedMary(w)
  const e = await w.open("admin", w.mary.userId, "export")
  const job = w.queue.jobs.find((j) => j.name === "dsr.export")!
  await w.jobs()
  const first = await w.get(e.body.id)
  await runJob(job.name, job.data, w.deps)
  await runJob(job.name, job.data, w.deps)
  expect(await w.get(e.body.id)).toEqual(first)
  expect((await q(w.tenant.id, `select count(*)::int n from files where purpose = 'dsr_export'`))[0].n).toBe(1)
  expect((await q(w.tenant.id, `select count(*)::int n from audit_events where action = 'dsr.export_completed'`))[0].n).toBe(1)
  // a duplicate while one is open is refused; after completion a new export is fine and gets its own file
  const e2 = await w.open("admin", w.mary.userId, "export")
  expect(e2.status).toBe(201)
  const dup = await w.open("admin", w.mary.userId, "export")
  expect(dup.status).toBe(409)
  expect(dup.body.code).toBe("request_open")

  const er = await w.open("owner", w.mary.userId, "erase")
  const ej = w.queue.jobs.find((j) => j.name === "dsr.erase")!
  await w.jobs()
  const done = await w.get(er.body.id)
  expect(done.status).toBe("completed")
  await runJob(ej.name, ej.data, w.deps)
  expect(await w.get(er.body.id)).toEqual(done)
  expect((await q(w.tenant.id, `select count(*)::int n from audit_events where action = 'dsr.erasure_completed'`))[0].n).toBe(1)
  // a job for an unknown request is a quiet no-op
  await runJob("dsr.erase", { requestId: crypto.randomUUID(), tenantId: w.tenant.id }, w.deps)
})

test("a crashed erase resumes: re-running a request left `failed` finishes it", async () => {
  const w = await world()
  await seedMary(w)
  let boom = true
  registerDsrHandler("flaky", { export: async () => ({}), erase: async () => { if (boom) throw Object.assign(new Error("Message-Sentinel-9917 database exploded"), { code: "flaky_failed" }) } })
  const er = await w.open("owner", w.mary.userId, "erase")
  await w.jobs()
  const failed = await w.get(er.body.id)
  expect(failed).toMatchObject({ status: "failed", errorCode: "flaky_failed" })
  expect(await q(w.tenant.id, `select 1 from memberships where user_id = $1`, [w.mary.userId])).toHaveLength(1) // all-or-nothing in the tenant tx
  expect(JSON.stringify(failed) + logs.join("\n")).not.toContain("Message-Sentinel-9917") // code only, never the message
  boom = false
  await runJob("dsr.erase", { requestId: er.body.id, tenantId: w.tenant.id }, w.deps) // the same job again
  await w.jobs()
  expect(await w.get(er.body.id)).toMatchObject({ status: "completed", errorCode: null })
  expect(await q(w.tenant.id, `select 1 from memberships where user_id = $1`, [w.mary.userId])).toHaveLength(0)
})

test("a failing export handler marks the request failed with its code and writes no file", async () => {
  const w = await world()
  registerDsrHandler("broken", { export: async () => { throw Object.assign(new Error("Message-Sentinel-4412"), { code: "broken_export" }) }, erase: async () => {} })
  const r = await w.req("POST", "/v1/me/data-export", w.c.mary)
  const id = ((await r.json()) as Json).id
  await w.jobs()
  expect(await w.get(id)).toMatchObject({ status: "failed", errorCode: "broken_export", resultFileId: null })
  expect(await q(w.tenant.id, `select 1 from files`)).toEqual([])
  expect(logs.join("\n")).not.toContain("Message-Sentinel-4412")
  // a failed request is not "open": the person may ask again
  expect((await w.req("POST", "/v1/me/data-export", w.c.mary)).status).toBe(201)
  const mine = (await (await w.req("GET", "/v1/me/data-export", w.c.mary)).json()) as Json[]
  expect(mine).toHaveLength(2)
  expect((await w.req("GET", "/v1/me/data-export", w.c.other)).status).toBe(200)
  expect(((await (await w.req("GET", "/v1/me/data-export", w.c.other)).json()) as Json[])).toEqual([])
})

test("self-service export is refused twice while one is open", async () => {
  const w = await world()
  expect((await w.req("POST", "/v1/me/data-export", w.c.mary)).status).toBe(201)
  const again = await w.req("POST", "/v1/me/data-export", w.c.mary)
  expect(again.status).toBe(409)
  expect(((await again.json()) as Json).code).toBe("request_open")
})

test("scrubPayload replaces the email (anywhere in a string) and a whole-value name, nothing else", () => {
  const p = { email: "Mary.Byrne@Example.ie", note: "sent to mary.byrne@example.ie today", name: "mary byrne", team: "Mary Byrne's team", n: 3, list: ["x", "MARY BYRNE"] }
  const s = scrubPayload(p, "mary.byrne@example.ie", "Mary Byrne")
  expect(s.changed).toBe(true)
  expect(s.value).toEqual({ email: "[erased]", note: "sent to [erased] today", name: "[erased]", team: "Mary Byrne's team", n: 3, list: ["x", "[erased]"] })
  expect(scrubPayload({ a: 1 }, "x@y.ie", "Nobody").changed).toBe(false)
})
