import { AuditLogSkeleton, DeniedSkeleton, auditLogData, getPlatformSeed } from "@/features/platform"
import { getMockOrg } from "@/lib/org"

import { skeletonGate } from "../../skeleton-gate"

// Same gate and view model as the page, rendered masked: identical layout.
export default async function Loading() {
  const g = await skeletonGate("audit.read", "the platform audit log")
  if ("denied" in g) return <DeniedSkeleton />
  const [seed, org] = await Promise.all([getPlatformSeed(), getMockOrg()])
  return <AuditLogSkeleton data={auditLogData(seed)} today={org.today} tzLabel={org.tzLabel} />
}
