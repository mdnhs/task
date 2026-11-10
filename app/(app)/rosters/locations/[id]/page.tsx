import { LocationFormPage } from "@/features/rosters"
import { AccessRestricted } from "@/features/shell"
import { locationAdminGate } from "../gate"

// Add ("new") or edit one location (FR-RS-01..04, 30). An id outside the role's permitted locations is "no access".
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, g] = await Promise.all([params, locationAdminGate()])
  if (!g || (id !== "new" && !g.data.locations.some((l) => l.id === id))) return <AccessRestricted moduleLabel="Locations" />
  return <LocationFormPage data={g.data} id={id} scopeKey={g.scopeKey} me={g.me} today={g.today} />
}
