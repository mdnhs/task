import { OrdersSkeleton, getOrders } from "@/features/orders"
import { PageSkeleton } from "@/features/shell"
import { can } from "@/lib/permissions"
import { canWrite } from "@/lib/permissions"
import { getSkeletonSession } from "@/lib/skeleton-session"

// Async so the skeleton uses the real Waiting approval count and the role's controls (loading.tsx gets no params).
export default async function Loading() {
  const session = await getSkeletonSession()
  if (!can(session.role, "orders")) return <PageSkeleton />
  const orders = await getOrders()
  return <OrdersSkeleton canWrite={canWrite(session, "orders")} rows={orders.filter((o) => o.approval === "pending").length} />
}
