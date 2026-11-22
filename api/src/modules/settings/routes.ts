import { createRoute, z } from "@hono/zod-openapi"
import { requirePermission } from "../../core/middleware/permission"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { withTenant } from "../../db/tenant-tx"
import { brandingWithStorage } from "./branding-routes"
import { getHolidays, getOrganisation, currentYear, patchOrganisation, putBranding, replaceHolidays } from "./service"

const Org = z.object({ name: z.string(), slug: z.string(), timezone: z.string(), currency: z.string(), locale: z.string(), reportDeadline: z.string(), reportDueAfterMinutes: z.number().int() })
const OrgExample = { name: "Acme Ltd", slug: "acme", timezone: "Europe/Dublin", currency: "EUR", locale: "en-IE", reportDeadline: "17:30", reportDueAfterMinutes: 60 }
const OrgPatch = z
  .object({ name: z.string().max(200), timezone: z.string().max(100), currency: z.string().max(10), locale: z.string().max(50), reportDeadline: z.string().max(10), reportDueAfterMinutes: z.number() })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined))
  .openapi({ example: { timezone: "Europe/London", currency: "GBP", locale: "en-GB", reportDeadline: "18:00", reportDueAfterMinutes: 90 } })
const Asset = z.object({ version: z.string(), mime: z.string(), width: z.number().int(), height: z.number().int(), sizeBytes: z.number().int() })
const AssetExample = { version: "9f86d081884c7d65", mime: "image/png", width: 240, height: 64, sizeBytes: 8123 }
const Branding = z.object({
  primaryColor: z.string().max(16).nullable(), logo: Asset.nullable(), favicon: Asset.nullable(),
  storageReady: z.boolean().openapi({ description: "false when no object storage is configured (the platform Storage settings): logo and favicon uploads cannot work yet" }),
})
const BrandingExample = { primaryColor: "#0A1B2C", logo: AssetExample, favicon: null, storageReady: true }
const BrandingBody = z.object({ primaryColor: z.string().max(16).nullable() }).openapi({ example: { primaryColor: "#0A1B2C" } })
const Holiday = z.object({ date: z.string().max(10), name: z.string().max(200) })
const HolidaysBody = z
  .object({ year: z.number().int().min(1970).max(2200), holidays: z.array(Holiday).max(100) })
  .openapi({ example: { year: 2026, holidays: [{ date: "2026-03-17", name: "St Patrick's Day" }, { date: "2026-12-25", name: "Christmas Day" }] } })

const orgGet = createRoute({
  method: "get", path: "/v1/settings/organisation", middleware: [requireTenant, requirePermission("settings", "read")] as const,
  responses: { 200: { description: "Organisation settings; reportDeadline falls back to the onboarding default", content: { "application/json": { schema: Org.openapi({ example: OrgExample }) } } } },
})
const orgPatch = createRoute({
  method: "patch", path: "/v1/settings/organisation", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { body: { content: { "application/json": { schema: OrgPatch } }, required: true } },
  responses: { 200: { description: "Updated settings. 422 invalid_name | invalid_timezone | invalid_locale | invalid_currency | invalid_report_deadline | invalid_report_due (minutes after a shift ends, 0-1440). Audited with before/after", content: { "application/json": { schema: Org.openapi({ example: OrgExample }) } } } },
})
const brandingGet = createRoute({
  method: "get", path: "/v1/settings/branding", middleware: [requireTenant, requirePermission("settings", "read")] as const,
  responses: { 200: { description: "Branding", content: { "application/json": { schema: Branding.openapi({ example: BrandingExample }) } } } },
})
const brandingPut = createRoute({
  method: "put", path: "/v1/settings/branding", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { body: { content: { "application/json": { schema: BrandingBody } }, required: true } },
  responses: { 200: { description: "The brand colour is saved; the logo and favicon are kept (they have their own routes under /v1/settings/branding/{kind}). 422 invalid_color (#RRGGBB)", content: { "application/json": { schema: Branding.openapi({ example: BrandingExample }) } } } },
})
const HolidaysOut = z.object({ year: z.number(), holidays: z.array(Holiday) }).openapi({ example: { year: 2026, holidays: [{ date: "2026-12-25", name: "Christmas Day" }] } })
const holidaysGet = createRoute({
  method: "get", path: "/v1/settings/holidays", middleware: [requireTenant, requirePermission("settings", "read")] as const,
  request: { query: z.object({ year: z.coerce.number().int().min(1970).max(2200).optional() }) },
  responses: { 200: { description: "Holidays of the year (default: the current year in the tenant's timezone), by date", content: { "application/json": { schema: HolidaysOut } } } },
})
const holidaysPut = createRoute({
  method: "put", path: "/v1/settings/holidays", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { body: { content: { "application/json": { schema: HolidaysBody } }, required: true } },
  responses: { 200: { description: "The year's set is replaced. 422 invalid_holiday_date | holiday_out_of_year | duplicate_holiday_date | invalid_holiday_name", content: { "application/json": { schema: HolidaysOut } } } },
})

export const settingsRoutes = newRouter()
  .openapi(orgGet, async (c) => {
    const t = c.get("tenant")!
    return c.json(await withTenant(c.get("deps").db, t.id, (tx) => getOrganisation(tx, t.id)), 200)
  })
  .openapi(orgPatch, async (c) => {
    const t = c.get("tenant")!
    return c.json(await patchOrganisation(c.get("deps"), t.id, c.get("member")!.userId, c.req.valid("json")), 200)
  })
  .openapi(brandingGet, async (c) => {
    const t = c.get("tenant")!
    return c.json(await brandingWithStorage(c.get("deps"), t.id), 200)
  })
  .openapi(brandingPut, async (c) => {
    const t = c.get("tenant")!
    const deps = c.get("deps")
    await putBranding(deps, t.id, c.get("member")!.userId, c.req.valid("json"))
    return c.json(await brandingWithStorage(deps, t.id), 200)
  })
  .openapi(holidaysGet, async (c) => {
    const t = c.get("tenant")!
    const deps = c.get("deps")
    return c.json(
      await withTenant(deps.db, t.id, async (tx) => {
        const year = c.req.valid("query").year ?? (await currentYear(tx, t.id, deps.clock.now()))
        return { year, holidays: await getHolidays(tx, t.id, year) }
      }),
      200,
    )
  })
  .openapi(holidaysPut, async (c) => {
    const t = c.get("tenant")!
    const { year, holidays } = c.req.valid("json")
    return c.json({ year, holidays: await replaceHolidays(c.get("deps"), t.id, c.get("member")!.userId, year, holidays) }, 200)
  })
