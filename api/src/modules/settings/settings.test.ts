import { readFileSync } from "node:fs"
import { beforeEach, expect, test } from "vitest"
import { ownerTenantQuery } from "../../../test/db"
import { call, fakeClock, resetDb, testApp } from "../../../test/harness"
import { makeMember, makeTenant, signIn } from "../../../test/factories"

beforeEach(resetDb)

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const q = (tenant: string, sql: string, params: unknown[] = []) => ownerTenantQuery(tenant, sql, params)
const DEFAULTS = JSON.parse(readFileSync(new URL("../../../../public/data/auth/onboarding-defaults.json", import.meta.url), "utf8")) as { deadline: string; reportDueAfterMinutes: number }

async function world(over: Parameters<typeof testApp>[0] = {}) {
  const t = testApp(over)
  const tenant = await makeTenant(t.deps, { slug: "acme", name: "Acme Ltd" })
  const other = await makeTenant(t.deps, { slug: "other" })
  const owner = await makeMember(t.deps, tenant.id, "owner")
  const auditor = await makeMember(t.deps, tenant.id, "auditor") // settings: read
  const staff = await makeMember(t.deps, tenant.id, "employee") // settings: none
  const otherOwner = await makeMember(t.deps, other.id, "owner")
  const co = (await signIn(t.app, owner.email, owner.password)).cookie
  const ca = (await signIn(t.app, auditor.email, auditor.password)).cookie
  const cs = (await signIn(t.app, staff.email, staff.password)).cookie
  const cx = (await signIn(t.app, otherOwner.email, otherOwner.password)).cookie
  const req = (method: string, path: string, cookie = co, body?: unknown, slug = tenant.slug) => call(t.app, method, path, { cookie, tenant: slug, body })
  return { ...t, tenant, other, owner, otherOwner, co, ca, cs, cx, req }
}
const audits = (tenant: string, action: string) => q(tenant, "select actor_id, before, after from audit_events where action = $1 order by seq", [action])

test("organisation GET returns the tenant's values; reads need settings:read", async () => {
  const w = await world()
  const r = await w.req("GET", "/v1/settings/organisation")
  expect(r.status).toBe(200)
  expect(await r.json()).toEqual({ name: "Acme Ltd", slug: "acme", timezone: "Europe/Dublin", currency: "EUR", locale: "en-IE", reportDeadline: DEFAULTS.deadline, reportDueAfterMinutes: DEFAULTS.reportDueAfterMinutes })
  expect((await w.req("GET", "/v1/settings/organisation", w.ca)).status).toBe(200)
  expect((await w.req("GET", "/v1/settings/organisation", w.cs)).status).toBe(403)
})

test("organisation patch validates timezone (IANA), locale (BCP-47) and currency (ISO 4217); audits before/after", async () => {
  const w = await world()
  const bad = async (body: unknown, code: string) => {
    const r = await w.req("PATCH", "/v1/settings/organisation", w.co, body)
    expect([r.status, ((await r.json()) as Json).code]).toEqual([422, code])
  }
  await bad({ timezone: "Mars/Olympus" }, "invalid_timezone")
  await bad({ timezone: "" }, "invalid_timezone")
  await bad({ locale: "en_IE!!" }, "invalid_locale")
  await bad({ currency: "euro" }, "invalid_currency")
  await bad({ currency: "ZZZ" }, "invalid_currency")
  await bad({ name: "   " }, "invalid_name")
  expect((await w.req("PATCH", "/v1/settings/organisation", w.co, {})).status).toBe(400) // empty patch
  expect(await audits(w.tenant.id, "tenant.settings_updated")).toHaveLength(0) // nothing was applied or audited

  const r = await w.req("PATCH", "/v1/settings/organisation", w.co, { timezone: "America/New_York", locale: "en-US", currency: "USD", name: "Acme Inc" })
  expect(r.status).toBe(200)
  expect(await r.json()).toMatchObject({ name: "Acme Inc", timezone: "America/New_York", locale: "en-US", currency: "USD" })
  const [t] = await q(w.tenant.id, "select name, timezone, currency, locale from tenants where id = $1", [w.tenant.id])
  expect(t).toMatchObject({ name: "Acme Inc", timezone: "America/New_York", currency: "USD", locale: "en-US" })
  const a = await audits(w.tenant.id, "tenant.settings_updated")
  expect(a).toHaveLength(1)
  expect(a[0].actor_id).toBe(w.owner.userId)
  expect(a[0].before).toEqual({ name: "Acme Ltd", timezone: "Europe/Dublin", currency: "EUR", locale: "en-IE" })
  expect(a[0].after).toEqual({ name: "Acme Inc", timezone: "America/New_York", currency: "USD", locale: "en-US" })
  // the other tenant is untouched
  expect(await (await w.req("GET", "/v1/settings/organisation", w.cx, undefined, "other")).json()).toMatchObject({ timezone: "Europe/Dublin", currency: "EUR" })
})

test("organisation patch needs settings:write (auditor 403, staff 403) and re-checks the actor", async () => {
  const w = await world()
  expect((await w.req("PATCH", "/v1/settings/organisation", w.ca, { name: "X" })).status).toBe(403)
  expect((await w.req("PATCH", "/v1/settings/organisation", w.cs, { name: "X" })).status).toBe(403)
  expect(await audits(w.tenant.id, "tenant.settings_updated")).toHaveLength(0)
})

test("report_deadline defaults from onboarding-defaults.json, not code; PATCH validates HH:MM and audits", async () => {
  const w = await world()
  expect(((await (await w.req("GET", "/v1/settings/organisation")).json()) as Json).reportDeadline).toBe(DEFAULTS.deadline)
  for (const v of ["25:00", "9:00", "17:60", "17:30:00", "noon"]) {
    const r = await w.req("PATCH", "/v1/settings/organisation", w.co, { reportDeadline: v })
    expect([v, r.status, ((await r.json()) as Json).code]).toEqual([v, 422, "invalid_report_deadline"])
  }
  const r = await w.req("PATCH", "/v1/settings/organisation", w.co, { reportDeadline: "18:05" })
  expect(r.status).toBe(200)
  expect(((await r.json()) as Json).reportDeadline).toBe("18:05")
  expect(((await (await w.req("GET", "/v1/settings/organisation")).json()) as Json).reportDeadline).toBe("18:05")
  const a = await audits(w.tenant.id, "tenant.settings_updated")
  expect(a[0].before).toEqual({ reportDeadline: DEFAULTS.deadline })
  expect(a[0].after).toEqual({ reportDeadline: "18:05" })
  // the other tenant still sees the default
  expect(((await (await w.req("GET", "/v1/settings/organisation", w.cx, undefined, "other")).json()) as Json).reportDeadline).toBe(DEFAULTS.deadline)
})

async function insertFile(w: Awaited<ReturnType<typeof world>>, tenantId: string, owner: string, status: string, purpose: string | null = null) {
  const id = crypto.randomUUID()
  await q(
    tenantId,
    `insert into files (id, tenant_id, owner_user_id, key, name, mime, size_bytes, status, purpose, created_at) values ($1::uuid, $2::uuid, $3, 't/' || $2::text || '/' || $1::text, 'logo.png', 'image/png', 10, $4, $5, now())`,
    [id, tenantId, owner, status, purpose],
  )
  return id
}

test("branding: a task, report or ordinary file can never become the logo or favicon, whoever holds settings:write (C6, T5.2 review)", async () => {
  const w = await world()
  for (const purpose of ["task_attachment", "task_evidence", "task_voice", "report_attachment", "report_export", "dsr_export", null, "branding_favicon"]) {
    const id = await insertFile(w, w.tenant.id, w.owner.userId, "clean", purpose)
    const r = await w.req("PUT", "/v1/settings/branding/logo", w.co, { fileId: id })
    expect([purpose, r.status, ((await r.json()) as Json).code]).toEqual([purpose, 404, "file_not_found"])
  }
  expect(await (await w.req("GET", "/v1/settings/branding", w.ca)).json()).toMatchObject({ logo: null, favicon: null, primaryColor: null })
  // the colour route no longer takes a file at all
  expect((await w.req("PUT", "/v1/settings/branding", w.co, { logoFileId: crypto.randomUUID(), primaryColor: null })).status).toBe(200)
  expect(await (await w.req("GET", "/v1/settings/branding", w.ca)).json()).toMatchObject({ logo: null })
})

test("branding: colour #RRGGBB, settings:write to change it, audited with before/after", async () => {
  const w = await world()
  const empty = await w.req("GET", "/v1/settings/branding")
  expect(await empty.json()).toEqual({ primaryColor: null, logo: null, favicon: null, storageReady: true })
  for (const c of ["red", "#12345", "#GGGGGG", "112233", "#1122334"]) {
    const r = await w.req("PUT", "/v1/settings/branding", w.co, { primaryColor: c })
    expect([c, r.status, ((await r.json()) as Json).code]).toEqual([c, 422, "invalid_color"])
  }
  expect(await audits(w.tenant.id, "tenant.branding_updated")).toHaveLength(0)
  const ok = await w.req("PUT", "/v1/settings/branding", w.co, { primaryColor: "#0A1B2c" })
  expect(ok.status).toBe(200)
  expect(await ok.json()).toEqual({ primaryColor: "#0A1B2c", logo: null, favicon: null, storageReady: true })
  expect(await (await w.req("GET", "/v1/settings/branding", w.ca)).json()).toMatchObject({ primaryColor: "#0A1B2c" })
  expect((await w.req("GET", "/v1/settings/branding", w.cs)).status).toBe(403)
  expect((await w.req("PUT", "/v1/settings/branding", w.ca, { primaryColor: null })).status).toBe(403)
  const cleared = await w.req("PUT", "/v1/settings/branding", w.co, { primaryColor: null })
  expect(await cleared.json()).toMatchObject({ primaryColor: null })
  const a = await audits(w.tenant.id, "tenant.branding_updated")
  expect(a).toHaveLength(2)
  expect(a[0].before).toEqual({ primaryColor: null })
  expect(a[0].after).toEqual({ primaryColor: "#0A1B2c" })
})

test("holidays: PUT replaces the year's set; dates must be inside the year, real and unique; audited; other years and tenants untouched", async () => {
  const w = await world()
  const put = (body: unknown, cookie = w.co) => w.req("PUT", "/v1/settings/holidays", cookie, body)
  const get = async (year: number, cookie = w.co, slug = w.tenant.slug) => ((await (await w.req("GET", `/v1/settings/holidays?year=${year}`, cookie, undefined, slug)).json()) as Json).holidays
  expect((await put({ year: 2026, holidays: [{ date: "2026-12-25", name: "Christmas Day" }, { date: "2026-03-17", name: "St Patrick's Day" }] })).status).toBe(200)
  expect((await put({ year: 2027, holidays: [{ date: "2027-01-01", name: "New Year's Day" }] })).status).toBe(200)
  expect(await get(2026)).toEqual([{ date: "2026-03-17", name: "St Patrick's Day" }, { date: "2026-12-25", name: "Christmas Day" }])

  const bad = async (body: unknown, code: string) => {
    const r = await put(body)
    expect([r.status, ((await r.json()) as Json).code]).toEqual([422, code])
  }
  await bad({ year: 2026, holidays: [{ date: "2027-01-01", name: "x" }] }, "holiday_out_of_year")
  await bad({ year: 2026, holidays: [{ date: "2026-02-30", name: "x" }] }, "invalid_holiday_date")
  await bad({ year: 2026, holidays: [{ date: "2026-05-04", name: "a" }, { date: "2026-05-04", name: "b" }] }, "duplicate_holiday_date")
  expect(await get(2026)).toHaveLength(2) // failed PUTs changed nothing

  expect((await put({ year: 2026, holidays: [{ date: "2026-08-03", name: "August Bank Holiday" }] })).status).toBe(200)
  expect(await get(2026)).toEqual([{ date: "2026-08-03", name: "August Bank Holiday" }])
  expect(await get(2027)).toHaveLength(1)
  expect(await get(2026, w.cx, "other")).toEqual([])
  expect((await put({ year: 2026, holidays: [] })).status).toBe(200)
  expect(await get(2026)).toEqual([])

  expect((await put({ year: 2026, holidays: [] }, w.ca)).status).toBe(403)
  expect((await w.req("GET", "/v1/settings/holidays?year=2026", w.cs)).status).toBe(403)
  expect(((await w.req("GET", "/v1/settings/holidays?year=2026", w.ca)).status)).toBe(200)

  const a = await audits(w.tenant.id, "tenant.holidays_replaced")
  expect(a).toHaveLength(4) // 2026, 2027, 2026 (replace), 2026 (clear); failed PUTs are not audited
  expect(a[2].before).toEqual({ year: 2026, holidays: [{ date: "2026-03-17", name: "St Patrick's Day" }, { date: "2026-12-25", name: "Christmas Day" }] })
  expect(a[2].after).toEqual({ year: 2026, holidays: [{ date: "2026-08-03", name: "August Bank Holiday" }] })
})

test("holidays GET without year defaults to the current year in the tenant's timezone", async () => {
  const w = await world({ clock: fakeClock(new Date("2026-12-31T20:00:00Z")) }) // 2026 in Dublin, already 2027 in Auckland
  await w.req("PUT", "/v1/settings/holidays", w.co, { year: 2027, holidays: [{ date: "2027-01-01", name: "New Year's Day" }] })
  expect(((await (await w.req("GET", "/v1/settings/holidays")).json()) as Json).year).toBe(2026)
  await w.req("PATCH", "/v1/settings/organisation", w.co, { timezone: "Pacific/Auckland" })
  expect(await (await w.req("GET", "/v1/settings/holidays")).json()).toEqual({ year: 2027, holidays: [{ date: "2027-01-01", name: "New Year's Day" }] })
})
