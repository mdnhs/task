import { REPORT_STATUS_ORDER } from "./types"
import type { Report, ReportsFilters } from "./types"

export const REPORT_PAGE_SIZE = 10
export const EMPTY_FILTERS: ReportsFilters = { from: "", to: "", owner: "all", status: "all" }

type Raw = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const day = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "")

// Reads ?from=&to=&owner=&status=. Unknown values fall back to "all" / empty.
export function parseFilters(sp: Raw, owners: string[] = []): ReportsFilters {
  const status = one(sp.status)
  const owner = one(sp.owner)
  return {
    from: day(one(sp.from)),
    to: day(one(sp.to)),
    owner: owner && owners.includes(owner) ? owner : "all",
    status: REPORT_STATUS_ORDER.includes(status as never) ? (status as string) : "all",
  }
}

export function matchesFilters(r: Report, f: ReportsFilters): boolean {
  return (
    (!f.from || r.date >= f.from) &&
    (!f.to || r.date <= f.to) &&
    (f.owner === "all" || r.owner === f.owner) &&
    (f.status === "all" || r.status === f.status)
  )
}
