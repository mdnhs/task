import { mockEnabled } from "@/lib/mock-registry"
import { AttentionSkeleton, getAttention } from "@/features/attention"
import { PageSkeleton } from "@/features/shell"
import { can } from "@/lib/permissions"
import { canWrite } from "@/lib/permissions"
import { getSkeletonSession } from "@/lib/skeleton-session"

// Async so the skeleton uses the real row counts and the role's controls (loading.tsx gets no params).
export default async function Loading() {
  if (!mockEnabled()) return <PageSkeleton /> // the page is the unavailable state: no seed to size a skeleton from
  const session = await getSkeletonSession()
  if (!can(session.role, "attention")) return <PageSkeleton />
  const { items, outstanding } = await getAttention()
  return <AttentionSkeleton items={items.filter((i) => i.status === "open").length} outstanding={outstanding.length} closed={outstanding.filter((o) => o.status === "closed").length} canWrite={canWrite(session, "attention")} />
}
