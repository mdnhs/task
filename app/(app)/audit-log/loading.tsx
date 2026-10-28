import { AuditSkeleton, getAuditEvents } from "@/features/audit"
import { PageSkeleton } from "@/features/shell"
import { can } from "@/lib/permissions"
import { getSession } from "@/lib/session"

// Async so the skeleton uses the real row count (loading.tsx gets no params).
export default async function Loading() {
  const session = await getSession()
  if (!can(session.role, "audit")) return <PageSkeleton />
  const events = await getAuditEvents()
  return <AuditSkeleton rows={events.length} />
}
