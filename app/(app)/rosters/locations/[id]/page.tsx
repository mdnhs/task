import { LocationFormPage } from "@/features/rosters"
import { AccessRestricted, getUser, mockGate } from "@/features/shell"
import { getSession } from "@/lib/session"
import { locationAdminGate } from "../gate"

// Add ("new") or edit one location (FR-RS-01..04, 30). An id outside the role's permitted locations is "no access".
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const off = mockGate("Location Rosters")
  if (off) return off
  const [{ id }, session, user] = await Promise.all([params, getSession(), getUser()])
  const g = await locationAdminGate(session, user)
  if (!g || (id !== "new" && !g.data.locations.some((l) => l.id === id))) return <AccessRestricted moduleLabel="Locations" />
  return <LocationFormPage data={g.data} id={id} scopeKey={g.scopeKey} me={g.me} today={g.today} />
}
