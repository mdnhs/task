import { AppShellSkeleton, PageSkeleton } from "@/features/shell"

// First load: the (app) layout is still fetching nav/user, so show the whole shell as a skeleton.
export default function Loading() {
  return (
    <AppShellSkeleton>
      <PageSkeleton />
    </AppShellSkeleton>
  )
}
