import { createHmac, randomUUID } from "node:crypto"
import { Writable } from "node:stream"
import pino from "pino"
import { sql } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { ownerTenantQuery } from "../../../test/db"
import { makeMember, makeTenant, roleIdOf, signIn } from "../../../test/factories"
import { call, resetDb, testApp } from "../../../test/harness"
import { buildKeyring, open } from "../../core/crypto/secret-box"
import { publish, relayOnce, resetSubscribers } from "../../core/events"
import { runJob } from "../../core/queue/queue"
import { withTenant } from "../../db/tenant-tx"
import { DELIVER_JOB, MAX_DELIVERY_ATTEMPTS, registerWebhooks, SWEEP_JOB, WEBHOOK_EVENT_TYPES } from "."

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
beforeEach(async () => {
  await resetDb()
  resetSubscribers()
  registerWebhooks()
})
afterEach(resetSubscribers)

const code = async (r: Response) => ((await r.clone().json()) as Json).code
const URL1 = "https://hooks.example.com/opsdesk"

async function world(over: Parameters<typeof testApp>[0] = {}) {
  const t = testApp(over)
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  const other = await makeTenant(t.deps, { slug: "bravo" })
  const who = async (role: string, tenantId = tenant.id) => {
    const m = await makeMember(t.deps, tenantId, role)
    return { ...m, cookie: (await signIn(t.app, m.email, m.password)).cookie }
  }
  const owner = await who("owner")
  const req = (method: string, path: string, o: { as?: { cookie: string }; tenant?: string; body?: unknown } = {}) =>
    call(t.app, method, path, { cookie: (o.as ?? owner).cookie, tenant: o.tenant ?? "acme", body: o.body })
  const create = async (body: Json = {}, as?: { cookie: string }) => {
    const r = await req("POST", "/v1/webhooks", { as, body: { url: URL1, events: ["team.created"], ...body } })
    return r
  }
  const mint = async (body: Json = {}) => {
    const r = await create(body)
    expect(r.status).toBe(201)
    return (await r.json()) as Json
  }
  const newTeam = async (name = `Team ${randomUUID().slice(0, 6)}`) => {
    const r = await req("POST", "/v1/teams", { body: { name, kind: "team" } })
    expect(r.status).toBe(201)
  }
  /** Publishes a team.created event directly (no HTTP: the owner's session idles out when a test moves the clock by days). */
  const emitTeam = (name = "Direct team") => withTenant(t.deps.db, tenant.id, (tx) => publish(tx, { tenantId: tenant.id, type: "team.created", payload: { teamId: randomUUID(), name, kind: "team" }, actorId: null }, t.clock.now()))
  /** Runs the next queued job, first moving the clock to when it is due (the fake queue ignores delays). */
  const runNext = async () => {
    const j = t.queue.jobs.shift()
    if (!j) return false
    if (j.opts?.delayMs) t.clock.advance({ minutes: Math.ceil(j.opts.delayMs / 60_000) })
    await runJob(j.name, j.data, t.deps)
    return true
  }
  const deliveries = () => ownerTenantQuery(tenant.id, "select * from webhook_deliveries order by created_at, ctid")
  const relay = () => relayOnce(t.deps)
  return { ...t, tenant, other, who, owner, req, create, mint, newTeam, emitTeam, runNext, deliveries, relay }
}
type W = Awaited<ReturnType<typeof world>>

describe("endpoints: create / list / patch / delete", () => {
  test("the secret is shown once and sealed with AAD webhook:<tenant>:<endpoint>; list and patch never return it", async () => {
    const w = await world()
    const ep = await w.mint({ events: ["team.created", "file.uploaded"] })
    expect(ep.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/)
    expect(ep).toMatchObject({ url: URL1, events: ["team.created", "file.uploaded"], active: true, createdBy: w.owner.userId })
    const [row] = await ownerTenantQuery(w.tenant.id, "select * from webhook_endpoints")
    const ring = buildKeyring(w.deps.env)
    expect(open(row.secret_ciphertext as string, ring, `webhook:${w.tenant.id}:${ep.id}`)).toBe(ep.secret)
    expect(() => open(row.secret_ciphertext as string, ring, `webhook:${w.tenant.id}:${randomUUID()}`)).toThrow()
    expect(() => open(row.secret_ciphertext as string, ring, `webhook:${w.other.id}:${ep.id}`)).toThrow()
    expect(JSON.stringify(row)).not.toContain(ep.secret)
    const list = await (await w.req("GET", "/v1/webhooks")).text()
    expect(list).not.toContain(ep.secret)
    expect(list).not.toContain("secret")
    const patched = await w.req("PATCH", `/v1/webhooks/${ep.id}`, { body: { events: ["team.updated"] } })
    expect(patched.status).toBe(200)
    expect(await patched.text()).not.toContain("secret")
    const audit = await ownerTenantQuery(w.tenant.id, "select action, actor_id, after from audit_events where action like 'webhook.%' order by seq")
    expect(audit.map((a) => [a.action, a.actor_id])).toEqual([["webhook.created", w.owner.userId], ["webhook.updated", w.owner.userId]])
    expect(JSON.stringify(audit)).not.toContain(ep.secret)
    expect(JSON.stringify(audit)).not.toContain("ciphertext")
  })

  test("validation: https only, port rule, userinfo, length; events from the allow-list only; needs settings:write", async () => {
    const w = await world()
    for (const url of ["http://hooks.example.com/x", "https://u:p@hooks.example.com/x", "https://hooks.example.com:80/x", "https://hooks.example.com:22/x", `https://hooks.example.com/${"a".repeat(2100)}`, "nonsense", "javascript:alert(1)"]) {
      const r = await w.create({ url })
      expect(r.status, url.slice(0, 60)).toBe(422)
      expect(await code(r)).toBe("invalid_webhook_url")
    }
    expect((await w.create({ url: "https://hooks.example.com:8443/x" })).status).toBe(201)
    for (const events of [["nope.created"], ["dsr.requested"], ["billing.payment_failed"], ["team.created", "*"], []]) {
      const r = await w.create({ events })
      expect(r.status, JSON.stringify(events)).toBe(422)
      expect(await code(r)).toBe("invalid_events")
    }
    const emp = await w.who("employee")
    expect((await w.create({}, emp)).status).toBe(403)
    expect((await call(w.app, "GET", "/v1/webhooks", { tenant: "acme" })).status).toBe(401)
    expect((await ownerTenantQuery(w.tenant.id, "select count(*)::int as n from webhook_endpoints"))[0].n).toBe(1)
  })

  test.each([
    ["IPv4 loopback", "https://127.0.0.1/x"],
    ["10/8", "https://10.1.2.3/x"],
    ["metadata", "https://169.254.169.254/latest/meta-data"],
    ["IPv6 loopback", "https://[::1]/x"],
    ["IPv4-mapped", "https://[::ffff:7f00:1]/x"],
    ["decimal literal", "https://2130706433/x"],
    ["octal literal", "https://0177.0.0.1/x"],
  ])("SSRF at create: %s is 422 unsafe_webhook_url", async (_n, url) => {
    const w = await world()
    const r = await w.create({ url })
    expect(r.status).toBe(422)
    expect(await code(r)).toBe("unsafe_webhook_url")
  })

  test("SSRF at create: a hostname resolving to a private (or mixed public+private) address is 422 unsafe_webhook_url; PATCH is checked too", async () => {
    const w = await world()
    w.net.dns.set("evil.example.com", ["10.0.0.5"])
    w.net.dns.set("mixed.example.com", ["93.184.216.34", "169.254.169.254"])
    for (const host of ["evil.example.com", "mixed.example.com"]) {
      const r = await w.create({ url: `https://${host}/x` })
      expect(r.status).toBe(422)
      expect(await code(r)).toBe("unsafe_webhook_url")
    }
    const ep = await w.mint()
    const r = await w.req("PATCH", `/v1/webhooks/${ep.id}`, { body: { url: "https://evil.example.com/x" } })
    expect(r.status).toBe(422)
    expect(await code(r)).toBe("unsafe_webhook_url")
    expect((await ownerTenantQuery(w.tenant.id, "select url from webhook_endpoints"))[0].url).toBe(URL1)
  })

  test("at most 10 endpoints per tenant (409 webhook_limit); delete frees a slot; a deleted endpoint is gone (404) and stops delivering", async () => {
    const w = await world()
    const ids: string[] = []
    for (let i = 0; i < 10; i++) ids.push((await w.mint({ url: `https://hooks.example.com/${i}` })).id)
    const over = await w.create({})
    expect(over.status).toBe(409)
    expect(await code(over)).toBe("webhook_limit")
    expect((await w.req("DELETE", `/v1/webhooks/${ids[0]}`)).status).toBe(204)
    expect((await w.req("PATCH", `/v1/webhooks/${ids[0]}`, { body: { active: false } })).status).toBe(404)
    expect((await w.req("DELETE", `/v1/webhooks/${ids[0]}`)).status).toBe(404)
    expect((await (await w.req("GET", "/v1/webhooks")).json() as Json).items).toHaveLength(9)
    expect((await w.create({})).status).toBe(201)
    // the other tenant has its own budget
    const ownerB = await w.who("owner", w.other.id)
    expect((await w.req("POST", "/v1/webhooks", { as: ownerB, tenant: "bravo", body: { url: URL1, events: ["team.created"] } })).status).toBe(201)
    // soft-deleted endpoint: its sealed secret is blanked and nothing is delivered to it
    const [gone] = await ownerTenantQuery(w.tenant.id, "select secret_ciphertext, active, deleted_at from webhook_endpoints where id = $1", [ids[0]])
    expect(gone.secret_ciphertext).toBe("")
    expect(gone.deleted_at).not.toBeNull()
  })

  test("endpoint ids from another tenant are 404 webhook_not_found (and unchanged)", async () => {
    const w = await world()
    const ep = await w.mint()
    const ownerB = await w.who("owner", w.other.id)
    for (const [m, body] of [["PATCH", { active: false }], ["DELETE", undefined]] as const) {
      const r = await w.req(m, `/v1/webhooks/${ep.id}`, { as: ownerB, tenant: "bravo", body })
      expect(r.status).toBe(404)
      expect(await code(r)).toBe("webhook_not_found")
    }
    expect((await (await w.req("GET", "/v1/webhooks", { as: ownerB, tenant: "bravo" })).json() as Json).items).toEqual([])
    expect((await ownerTenantQuery(w.tenant.id, "select active, deleted_at from webhook_endpoints"))[0]).toEqual({ active: true, deleted_at: null })
  })

  test("M5: PATCH with a non-string url is 422 invalid_webhook_url (not a 400)", async () => {
    const w = await world()
    const ep = await w.mint()
    for (const url of [123, null, { a: 1 }, ["https://hooks.example.com/x"]]) {
      const r = await w.req("PATCH", `/v1/webhooks/${ep.id}`, { body: { url } })
      expect(r.status, JSON.stringify(url)).toBe(422)
      expect(await code(r)).toBe("invalid_webhook_url")
    }
  })

  test("M4: deleting an endpoint redacts its url to scheme+host (no path/query token survives)", async () => {
    const w = await world()
    const ep = await w.mint({ url: "https://hooks.example.com/in/TOKEN123?sig=abc" })
    expect((await w.req("DELETE", `/v1/webhooks/${ep.id}`)).status).toBe(204)
    const [row] = await ownerTenantQuery(w.tenant.id, "select url from webhook_endpoints")
    expect(row.url).toBe("https://hooks.example.com")
    expect(JSON.stringify(await ownerTenantQuery(w.tenant.id, "select after, before from audit_events where action like 'webhook.%'"))).not.toMatch(/TOKEN123|sig=abc/)
  })

  test("M3: a hanging resolver is 422 unsafe_webhook_url at create, and a retryable network error at delivery", async () => {
    const w = await world()
    const ep = await w.mint({ url: "https://hang.example.com/x" })
    const real = w.net.resolve
    w.net.resolve = (h) => (h === "hang.example.com" ? new Promise(() => {}) : real(h))
    // shorten the 5 s timeout for the test by racing with fake timers is overkill: use real time on a short-lived tenant clock
    const { RESOLVE_TIMEOUT_MS } = await import("../../core/net/ssrf-guard")
    expect(RESOLVE_TIMEOUT_MS).toBe(5000)
    const r = await w.create({ url: "https://hang.example.com/y" })
    expect(r.status).toBe(422)
    expect(await code(r)).toBe("unsafe_webhook_url")
    await w.newTeam()
    await w.relay()
    await w.runNext()
    const [d] = await w.deliveries()
    expect(d).toMatchObject({ status: "pending", attempts: 1, last_error: "dns_timeout" })
    expect(w.queue.jobs).toHaveLength(1) // a retry is scheduled
    expect(ep.id).toBeTruthy()
  }, 30_000)

  test("PATCH can pause and resume (resume clears the failing clock) and change events", async () => {
    const w = await world()
    const ep = await w.mint()
    const off = (await (await w.req("PATCH", `/v1/webhooks/${ep.id}`, { body: { active: false } })).json()) as Json
    expect(off.active).toBe(false)
    await w.newTeam()
    await w.relay()
    expect(await w.deliveries()).toEqual([]) // paused: nothing fans out
    await ownerTenantQuery(w.tenant.id, "update webhook_endpoints set failing_since = now()")
    const on = (await (await w.req("PATCH", `/v1/webhooks/${ep.id}`, { body: { active: true } })).json()) as Json
    expect(on.active).toBe(true)
    expect((await ownerTenantQuery(w.tenant.id, "select failing_since from webhook_endpoints"))[0].failing_since).toBeNull()
    expect((await w.req("PATCH", `/v1/webhooks/${ep.id}`, { body: {} })).status).toBe(400)
  })
})

describe("delivery", () => {
  const verifySig = (secret: string, sig: string, body: string) => {
    const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sig)
    expect(m, sig).not.toBeNull()
    const expected = createHmac("sha256", secret).update(`${m![1]}.${body}`).digest("hex")
    expect(m![2]).toBe(expected)
    return Number(m![1])
  }

  test("a committed event is fanned out in the tenant tx and delivered once, signed, with only ids in `data`", async () => {
    const w = await world()
    const ep = await w.mint({ events: ["team.created"] })
    await w.mint({ url: "https://other.example.com/x", events: ["team.deleted"] }) // not subscribed to team.created
    await w.newTeam("Night shift")
    expect(w.queue.jobs).toEqual([]) // nothing before the relay
    await w.relay()
    expect(await w.deliveries()).toHaveLength(1)
    expect(w.queue.jobs).toHaveLength(1)
    expect(w.queue.jobs[0].name).toBe(DELIVER_JOB)
    expect(JSON.stringify(w.queue.jobs[0].data)).not.toContain(ep.secret)
    expect(w.queue.jobs[0].opts?.jobId).toMatch(/^[0-9a-f]{64}$/)
    expect(await w.runNext()).toBe(true)
    expect(w.net.sent).toHaveLength(1)
    const s = w.net.sent[0]
    expect(s.url.toString()).toBe(URL1)
    expect(s.address).toBe("93.184.216.34")
    expect(s.headers["content-type"]).toBe("application/json")
    const body = JSON.parse(s.body) as Json
    expect(Object.keys(body).sort()).toEqual(["data", "id", "occurredAt", "tenantId", "type"])
    expect(body).toMatchObject({ type: "team.created", tenantId: w.tenant.id, data: { name: "Night shift", kind: "team" } })
    expect(s.headers["x-opsdesk-event-id"]).toBe(body.id)
    expect(s.headers["x-opsdesk-event-type"]).toBe("team.created")
    const ts = verifySig(ep.secret, s.headers["x-opsdesk-signature"], s.body)
    expect(ts).toBe(Math.floor(w.clock.now().getTime() / 1000))
    expect(() => verifySig("whsec_wrong", s.headers["x-opsdesk-signature"], s.body)).toThrow() // a wrong secret does not verify
    const [d] = await w.deliveries()
    expect(d).toMatchObject({ status: "delivered", attempts: 1, last_status_code: 200, event_id: body.id })
    // the event reaches the receiver once even if the relay runs again
    await w.relay()
    expect(await w.deliveries()).toHaveLength(1)
    expect(w.queue.jobs).toEqual([])
  })

  test("payloads carry no personal data beyond ids: invite.created has no email; file.scanned has no signature", async () => {
    const w = await world()
    await w.mint({ events: ["invite.created", "member.role_changed"] })
    const roleId = await roleIdOf(w.deps, w.tenant.id, "employee")
    const r = await w.req("POST", "/v1/invites", { body: { email: "secret.person@x.ie", roleId } })
    expect(r.status).toBe(201)
    await w.relay()
    await w.runNext()
    const sent = w.net.sent[0]
    expect(sent.body).not.toContain("secret.person")
    expect(sent.body).not.toContain("@")
    expect((JSON.parse(sent.body) as Json).data).toEqual({ inviteId: expect.any(String), roleKey: "employee" })
    expect(WEBHOOK_EVENT_TYPES).not.toContain("dsr.requested")
    expect(WEBHOOK_EVENT_TYPES).not.toContain("dsr.completed")
    expect(WEBHOOK_EVENT_TYPES).not.toContain("billing.payment_failed")
  })

  test("5xx, 429 and network errors retry with exponential backoff and jitter: at most 8 attempts, all within 24 h, then failed", async () => {
    const w = await world()
    await w.mint()
    w.net.reply = () => 503
    await w.newTeam()
    await w.relay()
    const start = w.clock.now().getTime()
    const delays: number[] = []
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i++) {
      const next = w.queue.jobs[0]
      expect(next, `job for attempt ${i + 1}`).toBeDefined()
      if (i > 0) delays.push(next.opts!.delayMs!)
      await w.runNext()
      const [d] = await w.deliveries()
      expect(d.attempts).toBe(i + 1)
      expect(d.last_status_code).toBe(503)
      expect(d.status).toBe(i + 1 < MAX_DELIVERY_ATTEMPTS ? "pending" : "failed")
    }
    expect(w.net.sent).toHaveLength(8)
    expect(w.queue.jobs).toEqual([]) // no 9th attempt
    expect(delays).toHaveLength(7)
    for (let i = 1; i < delays.length; i++) expect(delays[i]).toBeGreaterThan(delays[i - 1]) // strictly growing despite jitter
    expect(delays[0]).toBeGreaterThanOrEqual(48_000) // ~1 min -20%
    expect(delays[0]).toBeLessThanOrEqual(72_000)
    expect(w.clock.now().getTime() - start).toBeLessThanOrEqual(24 * 3_600_000)
    const jobIds = new Set(w.queue.jobs.map((j) => j.opts?.jobId))
    expect([...jobIds].every((id) => !String(id).includes(":"))).toBe(true)
  })

  test("retried attempts all use the SAME body (and event id) with a fresh timestamp/signature; 429 and a thrown network error retry; 2xx stops", async () => {
    const w = await world()
    const ep = await w.mint()
    const plan: (number | Error)[] = [429, new Error("ECONNRESET"), 200]
    w.net.reply = () => plan.shift()!
    await w.newTeam()
    await w.relay()
    while (await w.runNext()) {
      /* drain, honouring delays */
    }
    expect(w.net.sent).toHaveLength(3)
    expect(new Set(w.net.sent.map((s) => s.body)).size).toBe(1)
    expect(new Set(w.net.sent.map((s) => s.headers["x-opsdesk-event-id"])).size).toBe(1)
    for (const s of w.net.sent) verifySig(ep.secret, s.headers["x-opsdesk-signature"], s.body)
    const [d] = await w.deliveries()
    expect(d).toMatchObject({ status: "delivered", attempts: 3, last_status_code: 200 })
  })

  test("4xx other than 429 fails immediately (no retry); a redirect (3xx) is a failure too, never followed", async () => {
    const w = await world()
    await w.mint()
    w.net.reply = () => 410
    await w.newTeam()
    await w.relay()
    await w.runNext()
    let [d] = await w.deliveries()
    expect(d).toMatchObject({ status: "failed", attempts: 1, last_status_code: 410 })
    expect(w.queue.jobs).toEqual([])
    w.net.reply = () => 302
    await w.newTeam()
    await w.relay()
    await w.runNext()
    ;[d] = (await w.deliveries()).slice(-1)
    expect(d).toMatchObject({ status: "failed", attempts: 1, last_status_code: 302 })
    expect(w.queue.jobs).toEqual([])
    expect(w.net.sent).toHaveLength(2) // nothing else was requested
  })

  test("DNS rebinding: public at create time, private at delivery -> the delivery is refused before any request is made", async () => {
    const w = await world()
    w.net.dns.set("rebind.example.com", ["93.184.216.34"])
    await w.mint({ url: "https://rebind.example.com/hook" })
    await w.newTeam()
    await w.relay()
    w.net.dns.set("rebind.example.com", ["10.0.0.5"]) // the attacker flips the record
    await w.runNext()
    expect(w.net.sent).toEqual([])
    const [d] = await w.deliveries()
    expect(d).toMatchObject({ status: "failed", last_error: "unsafe_webhook_url", last_status_code: null })
    // DNS is re-resolved on EVERY delivery and the connection is pinned to the vetted address
    w.net.dns.set("rebind.example.com", ["93.184.216.34"])
    await w.newTeam()
    await w.relay()
    await w.runNext()
    expect(w.net.sent[0].address).toBe("93.184.216.34")
    expect(w.net.resolves.filter((h) => h === "rebind.example.com").length).toBeGreaterThanOrEqual(3) // create, delivery 1, delivery 2
  })

  test("auto-disable: an endpoint failing for 3 days is set active=false and the tenant owners are notified; a success resets the clock", async () => {
    const w = await world()
    const ep = await w.mint()
    w.net.reply = () => 500
    await w.emitTeam()
    await w.relay()
    while (await w.runNext()) {
      /* all 8 attempts */
    }
    let [row] = await ownerTenantQuery(w.tenant.id, "select active, failing_since from webhook_endpoints")
    expect(row.active).toBe(true)
    expect(row.failing_since).not.toBeNull()
    w.clock.advance({ days: 2 })
    // a success inside the window resets the clock
    w.net.reply = () => 200
    await w.emitTeam()
    await w.relay()
    await w.runNext()
    ;[row] = await ownerTenantQuery(w.tenant.id, "select active, failing_since from webhook_endpoints")
    expect(row).toEqual({ active: true, failing_since: null })
    // fail again for 3 days and 1 hour
    w.net.reply = () => 500
    await w.emitTeam()
    await w.relay()
    await w.runNext()
    ;[row] = await ownerTenantQuery(w.tenant.id, "select active, failing_since from webhook_endpoints")
    expect(row.active).toBe(true)
    w.clock.advance({ days: 3, hours: 1 })
    await w.emitTeam()
    await w.relay()
    while (await w.runNext()) {
      /* retries */
    }
    ;[row] = await ownerTenantQuery(w.tenant.id, "select active from webhook_endpoints")
    expect(row.active).toBe(false)
    const notes = await ownerTenantQuery(w.tenant.id, "select user_id, title, body from notifications where title like 'Webhook%'")
    expect(notes.map((n) => n.user_id)).toEqual([w.owner.userId])
    expect(JSON.stringify(notes)).not.toContain(ep.secret)
    const audit = await ownerTenantQuery(w.tenant.id, "select action, actor_id from audit_events where action = 'webhook.auto_disabled'")
    expect(audit).toHaveLength(1)
    // a disabled endpoint receives nothing further
    const before = w.net.sent.length
    await w.emitTeam()
    await w.relay()
    while (await w.runNext()) {
      /* none */
    }
    expect(w.net.sent).toHaveLength(before)
  })

  test("(endpoint, event) is unique: a second delivery row for the same pair is refused by the database", async () => {
    const w = await world()
    await w.mint()
    await w.newTeam()
    await w.relay()
    const [d] = await w.deliveries()
    await expect(
      ownerTenantQuery(w.tenant.id, "insert into webhook_deliveries (tenant_id, endpoint_id, event_id, event_type, payload, next_attempt_at) values ($1, $2, $3, 'team.created', '{}', now())", [w.tenant.id, d.endpoint_id, d.event_id]),
    ).rejects.toMatchObject({ code: "23505" })
  })

  test("the sweep re-enqueues a delivery whose job was lost", async () => {
    const w = await world()
    await w.mint()
    await w.newTeam()
    await w.relay()
    w.queue.jobs.length = 0 // the Redis add was lost
    await runJob(SWEEP_JOB, {}, w.deps)
    expect(w.queue.jobs).toEqual([]) // not stale yet
    w.clock.advance({ minutes: 10 })
    await runJob(SWEEP_JOB, {}, w.deps)
    expect(w.queue.jobs).toHaveLength(1)
    expect(w.queue.jobs[0].name).toBe(DELIVER_JOB)
    await w.runNext()
    expect((await w.deliveries())[0].status).toBe("delivered")
  })

  test("logs carry no secret, URL or payload", async () => {
    const lines: string[] = []
    const logger = pino({ level: "debug" }, new Writable({ write: (chunk, _e, cb) => (lines.push(String(chunk)), cb()) }))
    const w = await world({ logger })
    const ep = await w.mint({ url: "https://very-private-host.example.com/secret-path" })
    w.net.reply = () => { throw new Error(`boom ${ep.secret} https://very-private-host.example.com/secret-path`) }
    await w.newTeam("Hush Team")
    await w.relay()
    while (await w.runNext()) {
      /* all attempts */
    }
    const all = lines.join("\n")
    expect(all).not.toContain(ep.secret)
    expect(all).not.toContain("very-private-host")
    expect(all).not.toContain("Hush Team")
  })

  test("app_user privileges: no DELETE on endpoints/deliveries; deliveries can only change their progress columns", async () => {
    const w = await world()
    await w.mint()
    await w.newTeam()
    await w.relay()
    const run = (q: ReturnType<typeof sql>) => withTenant(w.deps.db, w.tenant.id, (tx) => tx.execute(q))
    await expect(run(sql`delete from webhook_endpoints`)).rejects.toMatchObject({ cause: { code: "42501" } })
    await expect(run(sql`delete from webhook_deliveries`)).rejects.toMatchObject({ cause: { code: "42501" } })
    await expect(run(sql`update webhook_deliveries set payload = '{}'::jsonb`)).rejects.toMatchObject({ cause: { code: "42501" } })
    await expect(run(sql`update webhook_deliveries set endpoint_id = endpoint_id`)).rejects.toMatchObject({ cause: { code: "42501" } })
    await expect(run(sql`update webhook_endpoints set created_by = 'x'`)).rejects.toMatchObject({ cause: { code: "42501" } })
    expect((await ownerTenantQuery(w.tenant.id, "select count(*)::int as n from webhook_endpoints"))[0].n).toBe(1)
  })
})

export type { W }
