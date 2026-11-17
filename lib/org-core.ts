// The company's clock and settings as the UI needs them (B6 T6.4, ruling I12). Pure: the API client is an argument.
// Every value comes from endpoints a PLAIN MEMBER may call: /v1/me/tenant (zone, currency, locale and the report deadline, because staff cannot read
// the settings routes) and /v1/teams?kind=department (departments). Nothing here is a default for a real tenant: no zone, currency or locale is written in this file.
import type { ApiClient } from "./api/client"
import { wallInTz, zoneLabel } from "./tz"

export type Org = {
  /** The server clock as the tenant's local wall time, "YYYY-MM-DDTHH:mm:ss". */
  today: string
  timezone: string
  /** Readable zone name for ghost text and date lines ("New Zealand Time"). */
  tzLabel: string
  /** ISO 4217 code and BCP 47 locale for money (see lib/money.ts). */
  currency: string
  locale: string
  /** Shift-report deadline, "HH:mm" tenant-local. */
  deadline: string
  departments: string[]
}

export type OrgSources = { timezone: string; currency: string; locale: string; reportDeadline: string; departments: string[] }

export function composeOrg(s: OrgSources, now: Date): Org {
  return { today: wallInTz(now, s.timezone), timezone: s.timezone, tzLabel: zoneLabel(s.timezone, now), currency: s.currency, locale: s.locale, deadline: s.reportDeadline, departments: s.departments }
}

export async function loadOrg(api: Pick<ApiClient, "get">, now: Date = new Date()): Promise<Org> {
  const [ctx, teams] = await Promise.all([api.get("/v1/me/tenant"), api.get("/v1/teams", { query: { kind: "department" } })])
  return composeOrg({ timezone: ctx.tenant.timezone, currency: ctx.tenant.currency, locale: ctx.tenant.locale, reportDeadline: ctx.reportDeadline, departments: teams.map((t) => t.name) }, now)
}

/**
 * The org while the second factor is outstanding: the API refuses every tenant read (401 mfa_*), so there is nothing to show and nothing is guessed.
 * UTC and an empty department list; only the gate screen renders with it.
 */
export function neutralOrg(now: Date = new Date()): Org {
  return { today: wallInTz(now, "UTC"), timezone: "UTC", tzLabel: "UTC", currency: "USD", locale: "en", deadline: "", departments: [] }
}
