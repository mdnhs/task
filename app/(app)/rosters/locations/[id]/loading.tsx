import { LocationFormSkeleton } from "@/features/rosters"
import { PageSkeleton } from "@/features/shell"
import { locationAdminGate } from "../gate"

// loading.tsx gets no params, so the skeleton is the edit form of the first permitted location (the common case, like /rosters).
export default async function Loading() {
  const g = await locationAdminGate()
  if (!g) return <PageSkeleton />
  return <LocationFormSkeleton data={g.data} id={g.data.locations[0]?.id ?? "new"} scopeKey={g.scopeKey} me={g.me} today={g.today} />
}
