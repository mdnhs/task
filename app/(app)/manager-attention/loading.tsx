import { AttentionSkeleton, getAttention } from "@/features/attention"
import { PageSkeleton } from "@/features/shell"
import { can } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"

// Async so the skeleton uses the real row counts and the role's controls (loading.tsx gets no params).
export default async function Loading() {
  const session = await getSession()
  if (!can(session.role, "attention")) return <PageSkeleton />
  const { items, outstanding } = await getAttention()
  return <AttentionSkeleton items={items.filter((i) => i.status === "open").length} outstanding={outstanding.length} closed={outstanding.filter((o) => o.status === "closed").length} canWrite={canWrite(session, "attention")} />
}
