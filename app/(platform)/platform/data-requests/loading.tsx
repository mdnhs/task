import { DataRequestsSkeleton, DeniedSkeleton, dataRequestsData, getPlatformSeed, isDataView } from "@/features/platform"
import { getOrg } from "@/lib/org"
import { requestParam } from "@/lib/request-path"

import { gate } from "../../gate"

// Same gate, view model and saved view (`?view=`, forwarded by proxy.ts) as the page, rendered masked: identical layout.
export default async function Loading() {
  const g = await gate("data.requests", "platform data requests")
  if ("denied" in g) return <DeniedSkeleton />
  const [seed, org, view] = await Promise.all([getPlatformSeed(), getOrg(), requestParam("view")])
  return <DataRequestsSkeleton data={dataRequestsData(seed)} view={isDataView(view) ? view : "open"} today={org.today} operator={{ name: g.op.name, role: g.op.role }} />
}
