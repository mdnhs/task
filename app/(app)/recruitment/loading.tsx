import { RecruitmentSkeleton, getCandidates } from "@/features/recruitment"
import { PageSkeleton } from "@/features/shell"
import { can } from "@/lib/permissions"
import { canWrite } from "@/lib/permissions"
import { getSkeletonSession } from "@/lib/skeleton-session"

// Async so the skeleton uses the real per-stage counts and the role's controls (loading.tsx gets no params).
export default async function Loading() {
  const session = await getSkeletonSession()
  if (!can(session.role, "recruitment")) return <PageSkeleton />
  const { candidates } = await getCandidates()
  const counts: Record<string, number> = {}
  for (const c of candidates) counts[c.stage] = (counts[c.stage] ?? 0) + 1
  return <RecruitmentSkeleton canWrite={canWrite(session, "recruitment")} counts={counts} />
}
