import { LocationsView } from "@/features/rosters"
import { AccessRestricted, getUser } from "@/features/shell"
import { getSession } from "@/lib/session"
import { locationAdminGate } from "./gate"

// Locations admin (FR-RS-01, 30): office roles only.
export default async function Page() {
  const [session, user] = await Promise.all([getSession(), getUser()])
  const g = await locationAdminGate(session, user)
  if (!g) return <AccessRestricted moduleLabel="Locations" />
  return <LocationsView data={g.data} scopeKey={g.scopeKey} />
}
