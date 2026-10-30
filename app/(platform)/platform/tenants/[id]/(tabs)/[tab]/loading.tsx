import { DeniedSkeleton, Tenant360Skeleton, requireStaff, tabAction } from "@/features/platform"

import { gate } from "../../../../../gate"
import { TabBody, isTenantTab, load360, pathParts } from "../../t360"

// Switching tabs: the header stays (layout); the new tab renders masked from the same gate and view model as its page.
export default async function Loading() {
  const g = await gate("tenants.read", "platform tenants")
  if ("denied" in g) return <DeniedSkeleton />
  const { id, rest } = await pathParts()
  const v = id ? await load360(id, g.op) : null
  if (!v || !isTenantTab(rest)) return null
  if (!requireStaff(g.op, tabAction(rest))) return <DeniedSkeleton />
  return <Tenant360Skeleton label="Loading tab"><TabBody tab={rest} v={v} /></Tenant360Skeleton>
}
