import { SupportSkeleton, getPlatformSeed } from "@/features/platform"
import { getOrg } from "@/lib/org"

export default async function Loading() {
  const [{ requests, audit, tenants }, org] = await Promise.all([getPlatformSeed(), getOrg()])
  return <SupportSkeleton requests={requests} audit={audit} tenants={tenants} today={org.today} tzLabel={org.tzLabel} tz={org.timezone} />
}
