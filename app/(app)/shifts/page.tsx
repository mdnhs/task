import { ShiftsView, loadShifts, shiftsScreenData } from "@/features/shifts"
import { AccessRestricted, apiFailureView } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { shiftScope } from "@/lib/permissions"
import { canWrite, requireMfaOk } from "@/lib/session"

// Shifts (FR-M1-20/21, FR-M0-07) on the API (B6 T6.7). Write roles edit; staff-home readers get only their own shifts, cut by the API (nothing is re-scoped here). A team-scope manager reads
// but the API refuses their edits (403, shown as "All-scope managers only"). The week grid is the API's occurrences, from the stored instants.
export default async function Page() {
  const session = await requireMfaOk()
  const scope = shiftScope(session.role)
  if (scope === "none") return <AccessRestricted moduleLabel="Shifts" />
  const loaded = await Promise.all([shiftsScreenData(session), getOrg()])
    .then(async ([{ api, people }, org]) => ({ ok: true as const, org, data: await loadShifts(api, { tz: org.timezone, today: org.today, scope, meId: session.user.id, people }) }))
    .catch((e: unknown) => ({ ok: false as const, e }))
  if (!loaded.ok) {
    const v = apiFailureView(loaded.e, "Shifts")
    if (v) return v
    throw loaded.e
  }
  const { org, data } = loaded
  return <ShiftsView data={data} today={org.today} tz={org.timezone} tzLabel={org.tzLabel} canWrite={scope === "all" && canWrite(session, "shifts")} />
}
