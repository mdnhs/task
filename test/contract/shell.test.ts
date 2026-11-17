import { beforeEach, describe, expect, test } from "vitest"
import { z } from "zod"
import { makeApiClient } from "@/lib/api/client"
import { ApiError, classifyApiError } from "@/lib/api/problem"
import { toTenantEntitlements } from "@/lib/entitlements"
import { loadOrg } from "@/lib/org-core"
import { loadPeople } from "@/lib/people"
import { loadTenantEntitlements } from "@/lib/entitlements-data"
import { loadNotifications, markAllRead, markRead } from "@/lib/notifications"
import { resolveSession } from "@/lib/session-core"
import { canWrite } from "@/lib/permissions"
import { toInvoice, toSubscription } from "@/features/billing/adapters"
import { makeBillingClient } from "@/features/billing/client"
import ENT_DATA from "@/public/data/billing/entitlements.json"
import STATIC_ROLES from "@/public/data/shell/roles.json"
import type { EntitlementsData } from "@/lib/entitlements"
import type { Role } from "@/lib/types"
import { EntitlementsDto } from "../../api/src/modules/entitlements/routes"
import { InvoiceList, SubscriptionDto } from "../../api/src/modules/billing/routes"
import { NotificationDto, NotificationList } from "../../api/src/modules/notifications/routes"
import { PersonDto, TeamDto } from "../../api/src/modules/teams/routes"
import { MeDto, MeTenantDto } from "../../api/src/modules/tenants/routes"
import { changeSubscription } from "../../api/src/modules/entitlements"
import { notify } from "../../api/src/modules/notifications"
import { invoices } from "../../api/src/db/schema"
import { withTenant } from "../../api/src/db/tenant-tx"
import { makeMember, makeTenant, signIn } from "../../api/test/factories"
import { bootApi, resetDb } from "./harness"

beforeEach(resetDb)

const entData = ENT_DATA as unknown as EntitlementsData
const staticRoles = (STATIC_ROLES as unknown as { roles: Role[] }).roles
const labelOf = (key: string) => staticRoles.find((r) => r.id === key)?.label

/** A signed-in browser as the BFF would forward it: the session cookie, the tenant header, and a log of every status the API answered. */
async function actor(t: ReturnType<typeof bootApi>, who: { email: string; password: string }, slug: string) {
  const { cookie } = await signIn(t.app, who.email, who.password)
  const statuses: { path: string; status: number }[] = []
  const make = (tenant: string | null) =>
    makeApiClient({
      baseUrl: "http://api.test",
      fetch: async (input, init) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
        const headers = new Headers(init?.headers)
        headers.set("cookie", cookie)
        if (tenant) headers.set("x-tenant", tenant)
        if ((init?.method ?? "GET") !== "GET") headers.set("origin", t.origin)
        const res = await t.app.request(url.pathname + url.search, { method: init?.method ?? "GET", headers, body: init?.body as BodyInit | undefined })
        statuses.push({ path: url.pathname, status: res.status })
        return res
      },
    })
  const sessionDeps = {
    hasSessionCookie: true, tenantCookie: slug, entitlementsData: async () => entData, staticRoles: async () => staticRoles,
    api: async (o?: { tenant?: string | null }) => make(o?.tenant === undefined ? slug : o.tenant),
  }
  return { client: make(slug), statuses, sessionDeps }
}

async function world(sub: Parameters<typeof makeTenant>[1] = {}) {
  const t = bootApi()
  const tenant = await makeTenant(t.deps, { slug: "coppers", name: "Coppers", ...sub })
  const owner = await makeMember(t.deps, tenant.id, "owner")
  const staff = await makeMember(t.deps, tenant.id, "employee")
  return { t, tenant, owner, staff }
}

describe("T6.4 contract: the shell for a plain staff member never meets a 403", () => {
  test("a staff member (no settings:read, no audit) loads the shell and the home page without a single 403", async () => {
    const { t, tenant, owner, staff } = await world()
    // some content for the bell, written by the API's own notify()
    await withTenant(t.deps.db, tenant.id, (tx) => notify(tx, tenant.id, { userId: staff.userId, kind: "task", title: "A task was assigned to you", body: "Check the boiler", link: "/tasks" }, t.deps, () => undefined))
    void owner

    const a = await actor(t, staff, "coppers")
    const session = await resolveSession(a.sessionDeps)
    if (session.kind !== "ok") throw new Error(`expected a session, got ${session.kind}`)

    // everything the layout and the home page read for a member
    const org = await loadOrg(a.client)
    const people = await loadPeople(a.client, labelOf)
    const ent = await loadTenantEntitlements(a.client, async () => entData)
    const bell = await loadNotifications(a.client, org.timezone)

    expect(a.statuses.filter((s) => s.status === 403)).toEqual([])
    expect(a.statuses.filter((s) => s.status >= 400)).toEqual([])
    expect(org.timezone).toBe("Europe/Dublin") // the tenant's own default (a value the API sent, not a literal in the web)
    expect(org.deadline).toMatch(/^\d\d:\d\d$/)
    expect(session.session.role.id).toBe("employee")
    expect(ent.allowed).toContain("M1")
    expect(people.length).toBeGreaterThan(0)
    expect(bell.items.length).toBe(1)
  })

  test("the endpoints parse against their zod schemas and map through the adapters with no undefined field (owner and staff)", async () => {
    const { t, tenant, owner, staff } = await world()
    await withTenant(t.deps.db, tenant.id, async (tx) => {
      await tx.insert(invoices).values({ tenantId: tenant.id, providerInvoiceId: "in_contract_1", amountMinor: 14900, currency: "EUR", status: "paid", hostedUrl: "https://invoice.stripe.com/i/c1", periodStart: new Date("2026-11-01T00:00:00Z"), periodEnd: new Date("2026-12-01T00:00:00Z"), eventAt: new Date("2026-11-01T00:00:05Z"), createdAt: new Date("2026-11-01T00:00:05Z") })
      await notify(tx, tenant.id, { userId: owner.userId, kind: "billing", title: "Subscription past due", body: "Update your payment method", link: "/settings/billing" }, t.deps, () => undefined)
    })
    for (const who of [owner, staff]) {
      const a = await actor(t, who, "coppers")
      MeDto.parse(await a.client.get("/v1/me"))
      MeTenantDto.parse(await a.client.get("/v1/me/tenant"))
      const ent = EntitlementsDto.parse(await a.client.get("/v1/entitlements"))
      expect(toTenantEntitlements(ent, entData).allowed).toEqual(ent.modules)
      z.array(TeamDto).parse(await a.client.get("/v1/teams", { query: { kind: "department" } }))
      z.array(PersonDto).parse(await a.client.get("/v1/people"))
      const list = NotificationList.parse(await a.client.get("/v1/notifications"))
      list.items.forEach((n) => NotificationDto.parse(n))
      expect(a.statuses.filter((s) => s.status >= 400)).toEqual([])

      const org = await loadOrg(a.client)
      expect(Object.values(org).every((v) => v !== undefined && v !== "")).toBe(true)
      for (const p of await loadPeople(a.client, labelOf)) expect(Object.values(p).every((v) => v !== undefined)).toBe(true)
      for (const n of (await loadNotifications(a.client, org.timezone)).items) expect(Object.values(n).every((v) => v !== undefined)).toBe(true)
    }

    // billing is the owner's: parsed and mapped for the owner, a plain 403 forbidden for staff (the shell never asks)
    const o = await actor(t, owner, "coppers")
    const sub = toSubscription(SubscriptionDto.parse(await o.client.get("/v1/billing/subscription")))
    expect(sub).toMatchObject({ planId: "business", currency: "EUR" })
    expect(Number.isInteger(sub.priceMinor)).toBe(true)
    const inv = InvoiceList.parse(await o.client.get("/v1/billing/invoices", { query: { limit: 100 } }))
    expect(inv.items.map((i) => toInvoice(i).number)).toEqual(["in_contract_1"])
    const s = await actor(t, staff, "coppers")
    const refused = await s.client.get("/v1/billing/subscription").catch((e: unknown) => e)
    expect(refused).toBeInstanceOf(ApiError)
    expect(classifyApiError(refused).kind).toBe("forbidden")
  })

  test("the bell: list, mark one, mark all through the real routes", async () => {
    const { t, tenant, staff } = await world()
    await withTenant(t.deps.db, tenant.id, async (tx) => {
      for (const title of ["one", "two", "three"]) await notify(tx, tenant.id, { userId: staff.userId, kind: "task", title, body: title, link: "/tasks" }, t.deps, () => undefined)
    })
    const a = await actor(t, staff, "coppers")
    const first = await loadNotifications(a.client, "UTC")
    expect(first.unread).toBe(3)
    const one = await markRead(a.client, first.items[0]!.id, "UTC")
    expect(one.read).toBe(true)
    expect((await loadNotifications(a.client, "UTC")).unread).toBe(2)
    expect(await markAllRead(a.client)).toBe(2)
    expect((await loadNotifications(a.client, "UTC")).unread).toBe(0)
  })
})

describe("T6.4 contract: entitlements and the plan states", () => {
  test("a tenant on the starter plan (M0, M1) gets the 403 module_not_entitled the UI renders as 'Not in your plan'; the shell reads still pass", async () => {
    const { t, owner } = await world({ subscription: { planId: "starter", seats: 10 } })
    const a = await actor(t, owner, "coppers")
    const ent = await loadTenantEntitlements(a.client, async () => entData)
    expect(ent.allowed).toEqual(["M0", "M1"])
    // a route of a module outside the plan (M4 files): the module check answers before the body is looked at
    const e = await a.client.post("/v1/files/uploads", { body: {} as never }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ApiError)
    expect([(e as ApiError).status, classifyApiError(e).kind]).toEqual([403, "module_not_entitled"])
  })

  test("a blocked tenant: GET pages and the shell keep working, a write is 402 billing_required, billing stays reachable, the session is read-only", async () => {
    const { t, tenant, owner } = await world()
    await changeSubscription(t.deps, tenant.id, owner.userId, { status: "canceled" })
    const a = await actor(t, owner, "coppers")
    const org = await loadOrg(a.client) // GET works
    expect(org.timezone).toBeTruthy()
    const ent = EntitlementsDto.parse(await a.client.get("/v1/entitlements"))
    expect(ent.billingState).toBe("blocked")

    const write = await a.client.post("/v1/teams", { body: { name: "Night shift", kind: "team" } }).catch((e: unknown) => e)
    expect(classifyApiError(write).kind).toBe("billing_required")
    expect((write as ApiError).status).toBe(402)

    // billing is exempt: not a 402
    const sub = toSubscription(SubscriptionDto.parse(await a.client.get("/v1/billing/subscription")))
    expect(sub.billingState).toBe("blocked")
    const portal = await makeBillingClient(a.client, { go: () => undefined }).portal().catch((e: unknown) => e)
    expect((portal as ApiError).status).not.toBe(402)

    const r = await resolveSession(a.sessionDeps)
    if (r.kind !== "ok") throw new Error("expected a session")
    expect(r.session.billingState).toBe("blocked")
    expect(canWrite(r.session, "tasks")).toBe(false)
  })

  test("the seat cap: a local PUT, with the two 422 refusals the UI words", async () => {
    const { t, owner } = await world({ subscription: { planId: "business", seats: 20 } })
    const a = await actor(t, owner, "coppers")
    const billing = makeBillingClient(a.client, { go: () => undefined })
    expect((await billing.setSeats(25)).seats).toBe(25)
    const over = await billing.setSeats(41).catch((e: unknown) => e)
    expect([(over as ApiError).status, (over as ApiError).code]).toEqual([422, "seat_limit_exceeds_plan"])
    const below = await billing.setSeats(1).catch((e: unknown) => e)
    expect((below as ApiError).code).toBe("seats_below_members")
  })
})
