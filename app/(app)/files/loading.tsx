import { mockEnabled } from "@/lib/mock-registry"
import { FilesSkeleton, getFiles } from "@/features/files"
import { PageSkeleton } from "@/features/shell"
import { can } from "@/lib/permissions"
import { canWrite } from "@/lib/permissions"
import { getSkeletonSession } from "@/lib/skeleton-session"

// Async so the skeleton uses the real row count and the role's controls (loading.tsx gets no params).
export default async function Loading() {
  if (!mockEnabled()) return <PageSkeleton /> // the page is the unavailable state: no seed to size a skeleton from
  const session = await getSkeletonSession()
  if (!can(session.role, "files")) return <PageSkeleton />
  const { documents } = await getFiles()
  return <FilesSkeleton rows={documents.length} canWrite={canWrite(session, "files")} />
}
