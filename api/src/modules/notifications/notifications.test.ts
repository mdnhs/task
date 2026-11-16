import { Writable } from "node:stream"
import pino from "pino"
import { beforeEach, afterEach, expect, test } from "vitest"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { call, fakeClock, resetDb, testApp } from "../../../test/harness"
import { makeMember, makeTenant, signIn } from "../../../test/factories"
import { buildKeyring, open } from "../../core/crypto/secret-box"
import { publish, relayOnce, resetSubscribers } from "../../core/events"
import { runJob } from "../../core/queue/queue"
import { withTenant } from "../../db/tenant-tx"
import { makeLoggingPush } from "../../core/push"
import { notify, registerNotifications, withTenantAfterCommit } from "."

beforeEach(async () => {
  await resetDb()
  resetSubscribers()
  registerNotifications()
})
afterEach(resetSubscribers)

const q = <R = Record<string, unknown>>(tenant: string, sql: string, params: unknown[] = []) => ownerTenantQuery(tenant, sql, params) as Promise<R[]>

async function world(over: Parameters<typeof testApp>[0] = {}) {
  const t = testApp(over)
  const tenant = await makeTenant(t.deps)
  const owner = await makeMember(t.deps, tenant.id, "owner")
  const staff = await makeMember(t.deps, tenant.id, "employee")
  const co = (await signIn(t.app, owner.email, owner.password)).cookie
  const cs = (await signIn(t.app, staff.email, staff.password)).cookie
  t.mailer.sent.length = 0 // drop the sign-up verification mails
  return { ...t, tenant, owner, staff, co, cs }
}
type W = Awaited<ReturnType<typeof world>>

const send = (w: W, userId: string, kind: "invite" | "member" | "security" | "system" | "dsr" | "file", title = "Hello there", body = "Secret body text") =>
  withTenantAfterCommit(w.deps, w.tenant.id, (tx, enqueue) => notify(tx, w.tenant.id, { userId, kind, title, body, link: "/x" }, w.deps, enqueue))
/** Runs the jobs queued RIGHT NOW once (jobs they enqueue, e.g. retries, wait for the next call). */
const run = async (w: W) => {
  for (const j of w.queue.jobs.splice(0)) await runJob(j.name, j.data, w.deps)
}
const putPrefs = (w: W, cookie: string, body: unknown) => call(w.app, "PUT", "/v1/me/notification-preferences", { cookie, tenant: w.tenant.slug, body })
const addToken = (w: W, cookie: string, token = "fcm-token-AAAAAAAAAAAAAAAA") => call(w.app, "POST", "/v1/me/push-tokens", { cookie, tenant: w.tenant.slug, body: { token, platform: "android" } })
const deliveries = (w: W) => q(w.tenant.id, "select channel, status, attempts, send_after, last_error from notification_deliveries order by channel")

test("notify creates an in-app row and queues email per preference", async () => {
  const w = await world()
  await send(w, w.staff.userId, "invite") // email defaults ON for invite
  await send(w, w.staff.userId, "system") // email defaults OFF
  expect((await q(w.tenant.id, "select kind from notifications order by kind")).map((r) => r.kind)).toEqual(["invite", "system"])
  expect((await deliveries(w)).map((d) => `${d.channel}:${d.status}`)).toEqual(["email:queued"])
  expect(w.queue.jobs).toHaveLength(1)
  expect(w.queue.jobs[0].name).toBe("notification.send")
  expect(Object.keys(w.queue.jobs[0].data as object).sort()).toEqual(["deliveryId", "tenantId"]) // ids only, no content
  expect(JSON.stringify(w.queue.jobs[0].data)).not.toContain("Secret body")
  await run(w)
  expect(w.mailer.sent).toHaveLength(1)
  expect(w.mailer.sent[0]).toMatchObject({ to: w.staff.email, subject: "Hello there" })
  expect((await deliveries(w))[0]).toMatchObject({ status: "sent", attempts: 1 })

  // turning email on for "system" and in-app off for it: email only, hidden from the inbox
  expect((await putPrefs(w, w.cs, { channels: { system: { email: true, inApp: false } }, quietStart: null, quietEnd: null })).status).toBe(200)
  await send(w, w.staff.userId, "system", "Sys", "b")
  await run(w)
  expect(w.mailer.sent.map((m) => m.subject)).toEqual(["Hello there", "Sys"])
  const list = (await (await call(w.app, "GET", "/v1/notifications", { cookie: w.cs, tenant: w.tenant.slug })).json()) as { items: { kind: string }[] }
  expect(list.items.map((i) => i.kind).sort()).toEqual(["invite", "system"]) // the hidden one is not listed

  // everything off -> nothing created
  await putPrefs(w, w.cs, { channels: { dsr: { inApp: false, email: false, push: false } }, quietStart: null, quietEnd: null })
  await send(w, w.staff.userId, "dsr")
  expect(await q(w.tenant.id, "select 1 from notifications where kind = 'dsr'")).toEqual([])
})

test("push is queued only when the user has a token and is sent decrypted via deps.push", async () => {
  const w = await world()
  await send(w, w.staff.userId, "system")
  expect(await deliveries(w)).toEqual([]) // no token -> no push delivery
  expect((await addToken(w, w.cs)).status).toBe(201)
  await send(w, w.staff.userId, "system", "Ping", "pong")
  expect((await deliveries(w)).map((d) => `${d.channel}:${d.status}`)).toEqual(["push:queued"])
  await run(w)
  expect(w.push.sent).toEqual([{ token: "fcm-token-AAAAAAAAAAAAAAAA", msg: expect.objectContaining({ title: "Ping", body: "pong" }) }])
})

test("a request that rolls back sends nothing; one that commits enqueues after the commit", async () => {
  const w = await world()
  await expect(
    withTenantAfterCommit(w.deps, w.tenant.id, async (tx, enqueue) => {
      await notify(tx, w.tenant.id, { userId: w.staff.userId, kind: "invite", title: "t", body: "b" }, w.deps, enqueue)
      throw new Error("boom")
    }),
  ).rejects.toThrow("boom")
  expect(w.queue.jobs).toEqual([])
  expect(await q(w.tenant.id, "select 1 from notifications")).toEqual([])
  expect(await q(w.tenant.id, "select 1 from notification_deliveries")).toEqual([])

  let seenInside = -1
  await withTenantAfterCommit(w.deps, w.tenant.id, async (tx, enqueue) => {
    await notify(tx, w.tenant.id, { userId: w.staff.userId, kind: "invite", title: "t", body: "b" }, w.deps, enqueue)
    seenInside = w.queue.jobs.length
  })
  expect(seenInside).toBe(0) // not before commit
  expect(w.queue.jobs).toHaveLength(1)
})

test("a user only lists and marks their own notifications; another member's id is 404", async () => {
  const w = await world()
  await send(w, w.owner.userId, "system", "For owner")
  await send(w, w.staff.userId, "system", "For staff 1")
  await send(w, w.staff.userId, "system", "For staff 2")
  const get = async (cookie: string, qs = "") => (await (await call(w.app, "GET", `/v1/notifications${qs}`, { cookie, tenant: w.tenant.slug })).json()) as { items: { id: string; title: string; readAt: string | null }[]; unread: number }
  const own = await get(w.co)
  expect(own.items.map((i) => i.title)).toEqual(["For owner"])
  const mine = await get(w.cs)
  expect(mine.items.map((i) => i.title).sort()).toEqual(["For staff 1", "For staff 2"])
  expect(mine.unread).toBe(2)

  const post = (cookie: string, id: string) => call(w.app, "POST", `/v1/notifications/${id}/read`, { cookie, tenant: w.tenant.slug })
  const r404 = await post(w.cs, own.items[0].id) // staff -> owner's notification
  expect(r404.status).toBe(404)
  expect(((await r404.json()) as { code: string }).code).toBe("notification_not_found")
  expect((await q(w.tenant.id, "select read_at from notifications where title = 'For owner'"))[0].read_at).toBeNull()

  expect((await post(w.cs, mine.items[0].id)).status).toBe(200)
  expect((await get(w.cs, "?unread=true")).items).toHaveLength(1)
  const all = await call(w.app, "POST", "/v1/notifications/read-all", { cookie: w.cs, tenant: w.tenant.slug })
  expect(all.status).toBe(200)
  expect(((await all.json()) as { updated: number }).updated).toBe(1)
  expect((await get(w.cs, "?unread=true")).items).toEqual([])
  expect((await get(w.co, "?unread=true")).items).toHaveLength(1) // owner's untouched
})

test("security notifications ignore quiet hours for in-app and email", async () => {
  const w = await world({ clock: fakeClock(new Date("2026-11-16T23:30:00Z")) }) // 23:30 Dublin (GMT in November)
  expect((await putPrefs(w, w.cs, { channels: {}, quietStart: "22:00", quietEnd: "07:00" })).status).toBe(200)
  await send(w, w.staff.userId, "security", "New sign-in", "from a new device")
  expect((await deliveries(w)).map((d) => `${d.channel}:${d.status}`)).toEqual(["email:queued"])
  expect(w.queue.jobs[0].opts?.delayMs).toBeUndefined()
  await run(w)
  expect(w.mailer.sent.map((m) => m.subject)).toEqual(["New sign-in"])
  expect(await q(w.tenant.id, "select 1 from notifications where kind = 'security'")).toHaveLength(1)
})

test("quiet hours hold email and push until the window ends in tenant time", async () => {
  const w = await world({ clock: fakeClock(new Date("2026-11-16T23:30:00Z")) }) // 23:30 Europe/Dublin
  await addToken(w, w.cs)
  await putPrefs(w, w.cs, { channels: {}, quietStart: "22:00", quietEnd: "07:00" })
  await send(w, w.staff.userId, "invite", "Held", "b")
  const d = await deliveries(w)
  expect(d.map((x) => `${x.channel}:${x.status}`)).toEqual(["email:held", "push:held"])
  for (const x of d) expect((x.send_after as Date).toISOString()).toBe("2026-11-17T07:00:00.000Z")
  expect(w.queue.jobs.map((j) => j.opts?.delayMs)).toEqual([7.5 * 3600_000, 7.5 * 3600_000])
  const inApp = await q(w.tenant.id, "select 1 from notifications")
  expect(inApp).toHaveLength(1) // in-app is never held

  // A worker that picks a held job up early re-holds it instead of sending
  await run(w)
  expect(w.mailer.sent).toEqual([])
  expect(w.push.sent).toEqual([])
  expect((await deliveries(w)).map((x) => x.status)).toEqual(["held", "held"])
  expect(w.queue.jobs).toHaveLength(2) // re-enqueued for the window end

  w.clock.advance({ hours: 7, minutes: 30 })
  await run(w)
  expect(w.mailer.sent).toHaveLength(1)
  expect(w.push.sent).toHaveLength(1)
  expect((await deliveries(w)).map((x) => x.status)).toEqual(["sent", "sent"])
})

test("quiet hours use the TENANT's timezone, across the autumn DST change", async () => {
  const w2 = await world({ clock: fakeClock(new Date("2026-10-24T22:30:00Z")) })
  await putPrefs(w2, w2.cs, { channels: {}, quietStart: "22:00", quietEnd: "07:00" })
  await send(w2, w2.staff.userId, "invite")
  expect(((await deliveries(w2))[0].send_after as Date).toISOString()).toBe("2026-10-25T07:00:00.000Z")
  // another tenant timezone changes the answer for the same instant
  await ownerQuery("update tenants set timezone = 'Asia/Kolkata' where id = $1", [w2.tenant.id])
  await send(w2, w2.staff.userId, "invite", "second")
  const rows = await q(w2.tenant.id, "select n.title, d.send_after from notification_deliveries d join notifications n on n.id = d.notification_id order by n.created_at, n.title")
  expect(rows).toHaveLength(2)
  // 22:30Z = 04:00 IST next day -> quiet until 07:00 IST = 01:30Z
  expect((rows[1].send_after as Date).toISOString()).toBe("2026-10-25T01:30:00.000Z")
})

test("failed email delivery is retried with backoff up to 5 attempts then marked failed (logged, no body in log)", async () => {
  const lines: string[] = []
  const logger = pino({ level: "info" }, new Writable({ write(chunk, _e, cb) { lines.push(String(chunk)); cb() } }))
  const w = await world({ logger })
  w.mailer.send = async () => { throw Object.assign(new Error("smtp down for secret@x.ie: Secret body text"), { code: "ECONNRESET" }) }
  await send(w, w.staff.userId, "invite", "Subject S", "Secret body text")
  const delays: (number | undefined)[] = []
  for (let i = 1; i <= 5; i++) {
    expect(w.queue.jobs).toHaveLength(1)
    delays.push(w.queue.jobs[0].opts?.delayMs)
    await run(w)
    const [d] = await deliveries(w)
    expect(d.attempts).toBe(i)
    expect(d.status).toBe(i < 5 ? "queued" : "failed")
  }
  expect(delays).toEqual([undefined, 30_000, 60_000, 120_000, 240_000])
  expect(w.queue.jobs).toEqual([]) // no 6th attempt
  expect((await deliveries(w))[0].last_error).toBe("ECONNRESET")
  const log = lines.join("")
  expect(log).toContain("notification delivery failed")
  expect(log).not.toContain("Secret body")
  expect(log).not.toContain(w.staff.email)
  expect(log).not.toContain("Subject S")
})

test("push token stored encrypted with AAD push_token:<tenant>:<user>; raw token never returned", async () => {
  const w = await world()
  const token = "fcm-token-SUPER-SECRET-123456"
  const r = await addToken(w, w.cs, token)
  expect(r.status).toBe(201)
  const text = await r.text()
  expect(text).not.toContain(token)
  const body = JSON.parse(text) as { id: string; platform: string }
  expect(body.platform).toBe("android")
  const [row] = await q<{ token_hash: string; token_ciphertext: string; user_id: string }>(w.tenant.id, "select token_hash, token_ciphertext, user_id from push_tokens")
  expect(row.token_ciphertext.startsWith("v2:")).toBe(true)
  expect(row.token_ciphertext).not.toContain(token)
  const ring = buildKeyring(w.deps.env)
  expect(open(row.token_ciphertext, ring, `push_token:${w.tenant.id}:${w.staff.userId}`)).toBe(token)
  expect(() => open(row.token_ciphertext, ring, `push_token:${w.tenant.id}:${w.owner.userId}`)).toThrow()
  expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/)

  const again = await addToken(w, w.cs, token) // dedupe by hash
  expect(((await again.json()) as { id: string }).id).toBe(body.id)
  expect(await q(w.tenant.id, "select 1 from push_tokens")).toHaveLength(1)

  const del = (cookie: string) => call(w.app, "DELETE", `/v1/me/push-tokens/${body.id}`, { cookie, tenant: w.tenant.slug })
  const other = await del(w.co) // owner cannot delete staff's token
  expect(other.status).toBe(404)
  expect(((await other.json()) as { code: string }).code).toBe("push_token_not_found")
  expect((await del(w.cs)).status).toBe(204)
  expect(await q(w.tenant.id, "select 1 from push_tokens")).toEqual([])
})

test("PUT preferences validates quiet hours (HH:MM, start != end) → 422 otherwise", async () => {
  const w = await world()
  for (const bad of [
    { quietStart: "25:00", quietEnd: "07:00" },
    { quietStart: "22:00", quietEnd: "7:00" },
    { quietStart: "22:00", quietEnd: "22:00" },
    { quietStart: "22:00", quietEnd: null },
    { quietStart: null, quietEnd: "07:00" },
  ]) {
    const r = await putPrefs(w, w.cs, { channels: {}, ...bad })
    expect(r.status, JSON.stringify(bad)).toBe(422)
    expect(((await r.json()) as { code: string }).code).toBe("invalid_quiet_hours")
  }
  const ok = await putPrefs(w, w.cs, { channels: { member: { email: true } }, quietStart: "21:30", quietEnd: "06:15" })
  expect(ok.status).toBe(200)
  const got = (await (await call(w.app, "GET", "/v1/me/notification-preferences", { cookie: w.cs, tenant: w.tenant.slug })).json()) as { quietStart: string; quietEnd: string; channels: Record<string, { inApp: boolean; email: boolean; push: boolean }> }
  expect(got).toMatchObject({ quietStart: "21:30", quietEnd: "06:15" })
  expect(got.channels.member).toEqual({ inApp: true, email: true, push: true })
  expect(got.channels.invite).toEqual({ inApp: true, email: true, push: true })
  expect(got.channels.system).toEqual({ inApp: true, email: false, push: true })
  expect(got.channels.security).toEqual({ inApp: true, email: true, push: true })
  // defaults for a user who never saved anything
  const d = (await (await call(w.app, "GET", "/v1/me/notification-preferences", { cookie: w.co, tenant: w.tenant.slug })).json()) as { quietStart: null; channels: Record<string, { email: boolean }> }
  expect(d.quietStart).toBeNull()
  expect(Object.entries(d.channels).filter(([, v]) => v.email).map(([k]) => k).sort()).toEqual(["billing", "dsr", "invite", "security"])
})

test("member.joined event notifies the tenant's owners", async () => {
  const w = await world()
  const owner2 = await makeMember(w.deps, w.tenant.id, "owner")
  const joiner = await makeMember(w.deps, w.tenant.id, "employee")
  await withTenant(w.deps.db, w.tenant.id, (tx) => publish(tx, { tenantId: w.tenant.id, type: "member.joined", payload: { userId: joiner.userId, roleKey: "employee" }, actorId: joiner.userId }, w.deps.clock.now()))
  expect(await relayOnce(w.deps)).toBe(1)
  const rows = await q<{ user_id: string; kind: string }>(w.tenant.id, "select user_id, kind from notifications")
  expect(rows.map((r) => r.user_id).sort()).toEqual([w.owner.userId, owner2.userId].sort())
  expect(rows.every((r) => r.kind === "member")).toBe(true)
  expect(await relayOnce(w.deps)).toBe(0) // exactly once
  expect(await q(w.tenant.id, "select 1 from notifications")).toHaveLength(2)
})

// ---------------------------------------------------------------- fix wave: stuck deliveries

test("a running job never dedupes its own re-hold: job ids carry a per-enqueue nonce, no ':'", async () => {
  const w = await world({ clock: fakeClock(new Date("2026-11-16T23:30:00Z")) })
  await putPrefs(w, w.cs, { channels: {}, quietStart: "22:00", quietEnd: "07:00" })
  await send(w, w.staff.userId, "invite")
  const first = w.queue.jobs.splice(0)
  await runJob(first[0].name, first[0].data, w.deps) // re-hold
  await runJob(first[0].name, first[0].data, w.deps) // and again for the same sendAfter: must still enqueue
  expect(w.queue.jobs).toHaveLength(2)
  const ids = w.queue.jobs.map((j) => j.opts?.jobId as string)
  expect(new Set(ids).size).toBe(2)
  for (const id of ids) expect(id).not.toContain(":")
})

test("sweep: a queued delivery whose job was lost is sent; a held delivery past send_after is sent", async () => {
  const w = await world({ clock: fakeClock(new Date("2026-11-16T12:00:00Z")) })
  await addToken(w, w.cs)
  await send(w, w.staff.userId, "invite") // email + push queued
  w.queue.jobs.length = 0 // the jobs are lost
  await q(w.tenant.id, "update notification_deliveries set status = 'held', send_after = $1 where channel = 'push'", [new Date("2026-11-16T12:03:00Z")])
  await runJob("notification.sweep", {}, w.deps)
  expect(w.queue.jobs).toHaveLength(0) // nothing is stale yet (< 2 min)
  w.clock.advance({ minutes: 6 })
  await runJob("notification.sweep", {}, w.deps)
  expect(w.queue.jobs).toHaveLength(2)
  await run(w)
  expect(w.mailer.sent).toHaveLength(1)
  expect(w.push.sent).toHaveLength(1)
  expect((await deliveries(w)).map((x) => x.status)).toEqual(["sent", "sent"])
})

test("sweep skips deliveries that are leased, and one tenant failing does not stop the rest", async () => {
  const w = await world({ clock: fakeClock(new Date("2026-11-16T12:00:00Z")) })
  await send(w, w.staff.userId, "invite")
  w.queue.jobs.length = 0
  w.clock.advance({ minutes: 10 })
  await q(w.tenant.id, "update notification_deliveries set status = 'sending', claimed_until = $1", [new Date("2026-11-16T12:11:00Z")])
  await runJob("notification.sweep", {}, w.deps)
  expect(w.queue.jobs).toHaveLength(0)
  w.clock.advance({ minutes: 5 }) // lease expired
  await runJob("notification.sweep", {}, w.deps)
  expect(w.queue.jobs).toHaveLength(1)
})

test("two concurrent sends of the same delivery produce exactly one email", async () => {
  const w = await world()
  await send(w, w.staff.userId, "invite")
  const job = w.queue.jobs.splice(0)[0]
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const realSend = w.deps.mailer.send.bind(w.deps.mailer)
  w.deps.mailer.send = async (m) => {
    await gate
    return realSend(m)
  }
  const a = runJob(job.name, job.data, w.deps)
  const b = runJob(job.name, job.data, w.deps)
  await new Promise((r) => setTimeout(r, 300))
  release()
  await Promise.all([a, b])
  expect(w.mailer.sent).toHaveLength(1)
  const d = (await q(w.tenant.id, "select status, claimed_until from notification_deliveries"))[0]
  expect(d.status).toBe("sent")
})

test("a failed send goes back to queued with backoff and its lease cleared; an expired lease can be reclaimed", async () => {
  const w = await world({ clock: fakeClock(new Date("2026-11-16T12:00:00Z")) })
  await send(w, w.staff.userId, "invite")
  const job = w.queue.jobs.splice(0)[0]
  w.deps.mailer.send = async () => {
    throw new Error("smtp down")
  }
  await runJob(job.name, job.data, w.deps)
  expect((await deliveries(w))[0]).toMatchObject({ status: "queued", attempts: 1 })
  expect((await q(w.tenant.id, "select claimed_until from notification_deliveries"))[0].claimed_until).toBeNull()
  expect(w.queue.jobs).toHaveLength(1)
  // a crashed worker: status sending with an expired lease is claimable again, a live lease is not
  await q(w.tenant.id, "update notification_deliveries set status = 'sending', claimed_until = $1", [new Date("2026-11-16T12:01:00Z")])
  const sent: string[] = []
  w.deps.mailer.send = async (m) => void sent.push(m.to)
  await runJob(job.name, job.data, w.deps) // lease still live at 12:00
  expect(sent).toHaveLength(0)
  w.clock.advance({ minutes: 3 })
  await runJob(job.name, job.data, w.deps)
  expect(sent).toHaveLength(1)
})

test("with no push provider (logging adapter) the push delivery is skipped/no_provider, not sent", async () => {
  const w = await world({ push: makeLoggingPush(pino({ level: "silent" })) })
  await addToken(w, w.cs)
  await send(w, w.staff.userId, "system")
  await run(w)
  expect((await deliveries(w))[0]).toMatchObject({ channel: "push", status: "skipped", last_error: "no_provider" })
})
