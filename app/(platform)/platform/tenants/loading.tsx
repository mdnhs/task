import { DeniedSkeleton, TenantsSkeleton, getPlatformSeed, isTenantView, tenantsData } from "@/features/platform"
import { getOrg } from "@/lib/org"
import { requestParam } from "@/lib/request-path"

import { gate } from "../../gate"

// Same gate, view model and saved view (`?view=`, forwarded by proxy.ts) as the page, rendered masked: identical layout.
export default async function Loading() {
  const g = await gate("tenants.read", "platform tenants")
  if ("denied" in g) return <DeniedSkeleton />
  const [seed, org, view] = await Promise.all([getPlatformSeed(), getOrg(), requestParam("view")])
  return <TenantsSkeleton data={tenantsData(seed, g.op)} view={isTenantView(view) ? view : "all"} today={org.today} operator={{ name: g.op.name, role: g.op.role }} />
}
