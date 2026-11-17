import { TaskProjectsSkeleton, getProjects } from "@/features/tasks"
import { PageSkeleton } from "@/features/shell"
import { can } from "@/lib/permissions"
import { getSkeletonSession } from "@/lib/skeleton-session"

export default async function Loading() {
  const [session, projects] = await Promise.all([getSkeletonSession(), getProjects()])
  if (!can(session.role, "tasks")) return <PageSkeleton />
  return <TaskProjectsSkeleton milestones={projects.map((p) => p.milestones.length)} descriptions={projects.map((p) => p.description)} />
}
