import { LocationsView } from "@/features/rosters"
import { AccessRestricted } from "@/features/shell"
import { locationAdminGate } from "./gate"

// Locations admin (FR-RS-01, 30): office roles only.
export default async function Page() {
  const g = await locationAdminGate()
  if (!g) return <AccessRestricted moduleLabel="Locations" />
  return <LocationsView data={g.data} scopeKey={g.scopeKey} />
}
