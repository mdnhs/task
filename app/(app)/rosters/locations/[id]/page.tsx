import { LocationFormPage, loadLocationAdminData, loadRosterPeople } from "@/features/rosters"
import { AccessRestricted, apiFailureView, mockGate } from "@/features/shell"
import { ApiError } from "@/lib/api/problem"
import { can } from "@/lib/permissions"
import { requireMfaOk } from "@/lib/session"

// Add ("new") or edit one location on the API (FR-RS-01..04, 30, 34; B8 Task 22). Office roles only (the API's `access.level`); a location the caller may not see is the API's 404, the same
// "no access" as a missing one, and none of its data arrives.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const off = mockGate("Location Rosters")
  if (off) return off
  const [{ id }, session] = await Promise.all([params, requireMfaOk()])
  if (!can(session.role, "roster")) return <AccessRestricted moduleLabel="Locations" />
  const loaded = await Promise.all([id === "new" ? Promise.resolve(null) : loadLocationAdminData(id), loadRosterPeople()])
    .then(([admin, people]) => ({ ok: true as const, admin, people }))
    .catch((e: unknown) => ({ ok: false as const, e }))
  if (!loaded.ok) {
    const v = apiFailureView(loaded.e, "Locations")
    if (v) return v
    if (loaded.e instanceof ApiError && (loaded.e.status === 403 || loaded.e.status === 404)) return <AccessRestricted moduleLabel="Locations" />
    throw loaded.e
  }
  const { admin, people } = loaded
  if (people.access.level !== "office") return <AccessRestricted moduleLabel="Locations" />
  return <LocationFormPage location={admin?.location ?? null} shiftTypes={admin?.shiftTypes ?? []} people={people.members} truncated={people.truncated} />
}
