import { AppShellSkeleton, PageSkeleton, getNavigation } from "@/features/shell"

// First load: the (app) layout is still fetching nav/user, so show the whole shell as a skeleton.
// Departments come from the local nav JSON so the topbar filter skeleton matches the tenant's real pills.
export default async function Loading() {
  const { departments } = await getNavigation()
  return (
    <AppShellSkeleton departments={departments}>
      <PageSkeleton />
    </AppShellSkeleton>
  )
}
