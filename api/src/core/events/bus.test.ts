import { randomUUID } from "node:crypto"
import { beforeEach, afterEach, expect, test, vi } from "vitest"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { call, resetDb, testApp } from "../../../test/harness"
import { makeMember, makeTenant, roleIdOf, signIn, signUp } from "../../../test/factories"
import { withTenant } from "../../db/tenant-tx"
import { domainEvents, eventDeliveries } from "../../db/schema"
import { MAX_ATTEMPTS, publish, relayOnce, resetSubscribers, subscribe } from "."

beforeEach(async () => {
  await resetDb()
  resetSubscribers()
})
afterEach(resetSubscribers)

async function world() {
  const t = testApp()
  const a = await makeTenant(t.deps, { slug: "acme" })
  const b = await makeTenant(t.deps, { slug: "beta" })
  return { ...t, A: a.id, B: b.id, now: t.deps.clock.now() }
}
const emit = (w: Awaited<ReturnType<typeof world>>, tenant: string, type: "member.joined" | "invite.created" = "member.joined") =>
  withTenant(w.deps.db, tenant, (tx) => publish(tx, { tenantId: tenant, type, payload: { n: 1 }, actorId: null }, w.now))
const count = async (tenant: string, table: string, where = "true") =>
  Number((await ownerTenantQuery(tenant, `select count(*)::int as n from ${table} where ${where}`))[0].n)

test("publish inside a rolled-back tx leaves no event and no hint", async () => {
  const w = await world()
  await expect(
    withTenant(w.deps.db, w.A, async (tx) => {
      await publish(tx, { tenantId: w.A, type: "member.joined", payload: {}, actorId: null }, w.now)
      throw new Error("boom")
    }),
  ).rejects.toThrow("boom")
  expect(await count(w.A, "domain_events")).toBe(0)
  expect(await ownerQuery("select * from event_relay_hints")).toEqual([])
})

test("relayOnce delivers a published event to every matching subscriber and marks relayed_at", async () => {
  const w = await world()
  const spy = vi.fn(async () => {})
  const star = vi.fn(async () => {})
  const other = vi.fn(async () => {})
  subscribe("member.joined", "spy", spy)
  subscribe("*", "star", star)
  subscribe("invite.created", "other", other)
  const u = randomUUID()
  await withTenant(w.deps.db, w.A, (tx) => publish(tx, { tenantId: w.A, type: "member.joined", payload: { userId: u }, actorId: u }, w.now))
  expect(await relayOnce(w.deps)).toBe(1)
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: "member.joined", tenantId: w.A, payload: { userId: u }, actorId: u }), expect.objectContaining({ tx: expect.anything(), deps: w.deps }))
  expect(star).toHaveBeenCalledTimes(1)
  expect(other).not.toHaveBeenCalled()
  expect(await count(w.A, "domain_events", "relayed_at is not null")).toBe(1)
  expect(await ownerQuery("select * from event_relay_hints")).toEqual([]) // idle tenant: hint dropped
})

test("subscriber runs once when the same event is relayed twice", async () => {
  const w = await world()
  const spy = vi.fn(async () => {})
  subscribe("member.joined", "spy", spy)
  const id = await emit(w, w.A)
  expect(await relayOnce(w.deps)).toBe(1)
  // Simulate a crash after delivery but before relayed_at was committed: the event looks pending again.
  await ownerTenantQuery(w.A, "update domain_events set relayed_at = null where id = $1", [id])
  await ownerQuery("insert into event_relay_hints (tenant) values ($1)", [w.A])
  expect(await relayOnce(w.deps)).toBe(1) // completes (marks relayed) without re-running the handler
  expect(spy).toHaveBeenCalledTimes(1)
  expect(await count(w.A, "event_deliveries")).toBe(1)
})

test("a failing subscriber does not block others and is retried on the next relay", async () => {
  const w = await world()
  let fail = true
  const flaky = vi.fn(async (_e: unknown, ctx: { tx: Parameters<typeof withTenant>[2] extends (tx: infer T) => unknown ? T : never }) => {
    await ctx.tx.insert(domainEvents).values({ tenantId: w.A, type: "file.scanned", payload: {}, actorId: null, occurredAt: w.now }) // effect to be rolled back
    if (fail) throw new Error("nope")
  })
  const good = vi.fn(async () => {})
  subscribe("member.joined", "flaky", flaky as never)
  subscribe("member.joined", "good", good)
  await emit(w, w.A)
  expect(await relayOnce(w.deps)).toBe(0)
  expect(good).toHaveBeenCalledTimes(1)
  expect(await count(w.A, "domain_events", "relayed_at is null")).toBe(1)
  expect(await count(w.A, "domain_events", "type = 'file.scanned'")).toBe(0) // failed handler's effects rolled back
  expect(await count(w.A, "event_deliveries")).toBe(1) // only "good"
  fail = false
  expect(await relayOnce(w.deps)).toBe(0) // backing off: not due yet
  expect(flaky).toHaveBeenCalledTimes(1)
  w.clock.advance({ minutes: 1 })
  expect(await relayOnce(w.deps)).toBe(1)
  expect(flaky).toHaveBeenCalledTimes(2)
  expect(good).toHaveBeenCalledTimes(1) // not re-run
  expect(await count(w.A, "domain_events", "relayed_at is not null and type = 'member.joined'")).toBe(1)
})

test("two concurrent relays never deliver the same event to the same subscriber twice", async () => {
  const w = await world()
  const seen: string[] = []
  subscribe("*", "slow", async (e) => {
    seen.push(e.id)
    await new Promise((r) => setTimeout(r, 150))
  })
  for (let i = 0; i < 6; i++) await emit(w, w.A)
  const [x, y] = await Promise.all([relayOnce(w.deps, 3), relayOnce(w.deps, 3)])
  expect(x + y).toBe(6)
  expect(new Set(seen).size).toBe(6)
  expect(seen).toHaveLength(6)
  expect(await count(w.A, "event_deliveries")).toBe(6)
})

test("relay is per tenant: events are delivered with their own tenant and RLS holds", async () => {
  const w = await world()
  const got: string[] = []
  subscribe("*", "s", async (e, { tx }) => {
    got.push(e.tenantId)
    const rows = await tx.select({ id: domainEvents.id }).from(domainEvents)
    expect(rows).toHaveLength(1) // the tx only ever sees its own tenant's events
  })
  await emit(w, w.A)
  await emit(w, w.B)
  expect(await relayOnce(w.deps)).toBe(2)
  expect(got.sort()).toEqual([w.A, w.B].sort())
  expect(await count(w.B, "event_deliveries")).toBe(1)
})

test("a publish racing the idle-hint cleanup is never stranded without a hint", async () => {
  const w = await world()
  subscribe("*", "s", async () => {})
  await emit(w, w.A)
  await Promise.all([relayOnce(w.deps), emit(w, w.A)])
  await relayOnce(w.deps)
  expect(await count(w.A, "domain_events", "relayed_at is null")).toBe(0)
})

test("withTenant isolation: another tenant cannot read or write events/deliveries", async () => {
  const w = await world()
  const id = await emit(w, w.A)
  const rows = await withTenant(w.deps.db, w.B, (tx) => tx.select().from(domainEvents))
  expect(rows).toEqual([])
  await expect(
    withTenant(w.deps.db, w.B, (tx) => tx.insert(eventDeliveries).values({ tenantId: w.A, eventId: id, subscriber: "x", deliveredAt: w.now })),
  ).rejects.toMatchObject({ cause: { code: "42501" } })
})

test("duplicate subscriber names are rejected", () => {
  subscribe("*", "dup", async () => {})
  expect(() => subscribe("member.joined", "dup", async () => {})).toThrow(/Duplicate/)
})

test("invite creation publishes invite.created; accept publishes member.joined (same tx as audit)", async () => {
  const t = testApp()
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  const admin = await makeMember(t.deps, tenant.id, "admin")
  const { cookie } = await signIn(t.app, admin.email, admin.password)
  const roleId = await roleIdOf(t.deps, tenant.id, "employee")
  const r = await call(t.app, "POST", "/v1/invites", { cookie, tenant: "acme", body: { email: "new@x.ie", roleId } })
  expect(r.status).toBe(201)
  const ev = await ownerTenantQuery(tenant.id, "select type, payload, actor_id from domain_events")
  expect(ev).toHaveLength(1)
  expect(ev[0]).toMatchObject({ type: "invite.created", actor_id: admin.userId })
  expect(JSON.stringify(ev[0].payload)).not.toMatch(/token/i)
  const token = t.mailer.last().text.match(/\/invite\?token=([\w-]+)/)![1]
  await signUp(t.app, "new@x.ie", "Passw0rd!long", "New")
  const nc = (await signIn(t.app, "new@x.ie", "Passw0rd!long")).cookie
  expect((await call(t.app, "POST", "/v1/invites/accept", { cookie: nc, body: { token } })).status).toBe(200)
  const types = (await ownerTenantQuery(tenant.id, "select type from domain_events order by occurred_at, type")).map((e) => e.type)
  expect(types.sort()).toEqual(["invite.created", "member.joined"])
  const audits = await ownerTenantQuery(tenant.id, "select count(*)::int as n from audit_events where action in ('invite.created','member.joined')")
  expect(audits[0].n).toBe(2)
})

test("changing a member's role publishes member.role_changed", async () => {
  const t = testApp()
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  const admin = await makeMember(t.deps, tenant.id, "admin")
  const emp = await makeMember(t.deps, tenant.id, "employee")
  const { cookie } = await signIn(t.app, admin.email, admin.password)
  const mgr = await roleIdOf(t.deps, tenant.id, "manager")
  const r = await call(t.app, "PATCH", `/v1/members/${emp.userId}`, { cookie, tenant: "acme", body: { roleId: mgr } })
  expect(r.status).toBe(200)
  const ev = await ownerTenantQuery(tenant.id, "select type, payload from domain_events")
  expect(ev).toHaveLength(1)
  expect(ev[0]).toMatchObject({ type: "member.role_changed", payload: { userId: emp.userId, toRoleKey: "manager", fromRoleKey: "employee" } })
})

// ---- fix round 1 ----
test("handler enqueues then throws: nothing reaches the queue", async () => {
  const w = await world()
  subscribe("member.joined", "mail", async (_e, ctx) => {
    ctx.enqueue("mail.send", { to: "x" })
    throw new Error("boom")
  })
  await emit(w, w.A)
  await relayOnce(w.deps)
  expect(w.queue.jobs).toEqual([])
})

test("enqueue before a failing relayed_at update/commit: nothing reaches the queue, no delivery persisted", async () => {
  const w = await world()
  subscribe("member.joined", "mail", async (_e, ctx) => ctx.enqueue("mail.send", { to: "x" }))
  await emit(w, w.A)
  await ownerQuery(`create function fail_relay() returns trigger language plpgsql as $$ begin if new.relayed_at is not null then raise exception 'sim'; end if; return new; end $$`)
  await ownerQuery("create trigger fail_relay before update on domain_events for each row execute function fail_relay()")
  try {
    expect(await relayOnce(w.deps)).toBe(0)
  } finally {
    await ownerQuery("drop trigger fail_relay on domain_events")
    await ownerQuery("drop function fail_relay()")
  }
  expect(w.queue.jobs).toEqual([])
  expect(await count(w.A, "event_deliveries")).toBe(0)
})

test("one tenant's relay failure does not skip other tenants", async () => {
  const w = await world()
  subscribe("*", "s", async () => {})
  await emit(w, w.A)
  await emit(w, w.B)
  await ownerQuery(`create function fail_a() returns trigger language plpgsql as $$ begin if new.tenant_id = '${w.A}' and new.relayed_at is not null then raise exception 'sim'; end if; return new; end $$`)
  await ownerQuery("create trigger fail_a before update on domain_events for each row execute function fail_a()")
  try {
    expect(await relayOnce(w.deps)).toBe(1)
  } finally {
    await ownerQuery("drop trigger fail_a on domain_events")
    await ownerQuery("drop function fail_a()")
  }
  expect(await count(w.B, "domain_events", "relayed_at is not null")).toBe(1)
  expect(await count(w.A, "domain_events", "relayed_at is null")).toBe(1)
})

test("successful delivery enqueues exactly one job after commit; re-relay enqueues none", async () => {
  const w = await world()
  subscribe("member.joined", "mail", async (e, ctx) => ctx.enqueue("mail.send", { id: e.id }))
  const id = await emit(w, w.A)
  expect(await relayOnce(w.deps)).toBe(1)
  expect(w.queue.jobs).toHaveLength(1)
  expect(w.queue.jobs[0]).toMatchObject({ name: "mail.send", opts: { jobId: `${id}:mail:mail.send` } })
  await ownerTenantQuery(w.A, "update domain_events set relayed_at = null where id = $1", [id])
  await ownerQuery("insert into event_relay_hints (tenant) values ($1) on conflict do nothing", [w.A])
  await relayOnce(w.deps)
  expect(w.queue.jobs).toHaveLength(1)
})

test("a permanently failing subscriber backs off, dies after MAX_ATTEMPTS, and newer events still deliver", async () => {
  const w = await world()
  const good = vi.fn(async () => {})
  subscribe("member.joined", "bad", async () => { throw new Error("secret-pii@x.ie") })
  subscribe("invite.created", "good", good)
  const badId = await emit(w, w.A, "member.joined")
  const stamps: number[] = []
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    await relayOnce(w.deps)
    const [f] = await ownerTenantQuery(w.A, "select attempts, next_attempt_at, dead_at, last_error_code from event_delivery_failures where event_id = $1", [badId])
    expect(f.attempts).toBe(i)
    stamps.push(new Date(f.next_attempt_at as string).getTime() - w.deps.clock.now().getTime())
    if (i === 1) {
      // newer event for the same tenant is delivered while the first backs off
      await emit(w, w.A, "invite.created")
      expect(await relayOnce(w.deps)).toBe(1)
      expect(good).toHaveBeenCalledTimes(1)
    }
    if (i < MAX_ATTEMPTS) {
      expect(await relayOnce(w.deps)).toBe(0) // not due yet
      w.clock.advance({ hours: 2 })
    }
  }
  expect(stamps[1]).toBeGreaterThan(stamps[0])
  expect(stamps[2]).toBeGreaterThan(stamps[1])
  const [dead] = await ownerTenantQuery(w.A, "select attempts, dead_at, last_error_code from event_delivery_failures where event_id = $1", [badId])
  expect(dead.dead_at).not.toBeNull()
  expect(dead.attempts).toBe(MAX_ATTEMPTS)
  expect(await count(w.A, "domain_events", "id = '" + badId + "' and relayed_at is not null")).toBe(1) // dead = done
  expect(await ownerQuery("select * from event_relay_hints")).toEqual([])
})

test("relay logs never contain the error message", async () => {
  const lines: string[] = []
  const w0 = testApp({ logger: { error: (o: unknown) => lines.push(JSON.stringify(o)), info() {}, warn() {}, debug() {} } as never })
  const a = await makeTenant(w0.deps, { slug: "acme" })
  subscribe("*", "bad", async () => { throw new Error("secret-pii@x.ie") })
  await withTenant(w0.deps.db, a.id, (tx) => publish(tx, { tenantId: a.id, type: "member.joined", payload: {}, actorId: null }, w0.deps.clock.now()))
  await relayOnce(w0.deps)
  expect(lines.length).toBeGreaterThan(0)
  expect(lines.join()).not.toMatch(/secret-pii/)
})
