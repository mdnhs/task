import { RostersView, historyWeekOf, loadChangeRequests, loadExchanges, loadRosterData, loadWeekHistory, loadWeekTemplates, type RosterPanels, type RosterQuery } from "@/features/rosters"
import { AccessRestricted, apiFailureView } from "@/features/shell"
import { ApiError } from "@/lib/api/problem"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { requireMfaOk } from "@/lib/session"

const ISO = /^\d{4}-\d{2}-\d{2}$/
const VIEWS = ["day", "week", "fortnight", "month"] as const

const HISTORY_PAGE = 20
/** A panel's list that the API refuses for this caller (a role with no such view) is simply empty; any other failure is the page's error. */
const safe = async <T,>(read: Promise<T>, empty: T): Promise<T> => {
  try {
    return await read
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return empty
    throw e
  }
}

/** What the panels under the week need: the change requests and exchanges the caller may see, and the first page of one week's history. The API cuts each to the caller's sites. */
async function readPanels(payload: Awaited<ReturnType<typeof loadRosterData>>, location: string | undefined): Promise<RosterPanels> {
  if (payload.access.level === null) return { requests: [], exchanges: [], history: null }
  const week = historyWeekOf(payload, location)
  const [requests, exchanges, history] = await Promise.all([
    safe(loadChangeRequests({ status: "requested" }), { items: [], nextCursor: null }),
    safe(loadExchanges(), { items: [], nextCursor: null }),
    week ? safe(loadWeekHistory(week.id, undefined, HISTORY_PAGE), null) : Promise.resolve(null),
  ])
  return { requests: requests.items, exchanges: exchanges.items, history: week && history ? { weekId: week.id, page: history } : null }
}

// Location Rosters, week view (FR-RS-10/11/12, B8 Task 20). The API cuts the payload to the caller's locations and says what they may do (`access`): a location the caller may not open is a 404 there
// ("no access" here) and none of its data arrives. The page re-reads the API on every navigation; edits go through the roster server actions.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [sp, session, org] = await Promise.all([searchParams, requireMfaOk(), getOrg()])
  if (!can(session.role, "roster")) return <AccessRestricted moduleLabel="Location Rosters" />
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined)
  const query: RosterQuery = { location: one("location"), week: one("week"), view: one("view"), group: one("group") }
  const view = VIEWS.find((v) => v === query.view)
  const loaded = await loadRosterData({ locationId: query.location && query.location !== "all" ? query.location : undefined, from: query.week && ISO.test(query.week) ? query.week : undefined, view })
    .then(async (payload) => ({ ok: true as const, payload, templates: payload.access.canEdit ? await loadWeekTemplates(query.location && query.location !== "all" ? query.location : undefined) : [] }))
    .catch((e: unknown) => ({ ok: false as const, e }))
  if (!loaded.ok) {
    const v = apiFailureView(loaded.e, "Location Rosters")
    if (v) return v
    if (loaded.e instanceof ApiError && loaded.e.status === 404) return <AccessRestricted moduleLabel="Location Rosters" />
    throw loaded.e
  }
  const { payload, templates } = loaded
  if (payload.locations.length === 0) return <AccessRestricted moduleLabel="Location Rosters" />
  const panels = await readPanels(payload, query.location)
  return <RostersView payload={payload} query={query} today={org.today} templates={templates} panels={panels} me={session.user.id} />
}
