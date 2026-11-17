import { filterForStaff, getOperator, getPlatformEnv, getPlatformNav } from "@/features/platform"
import { AppShellSkeleton, PageSkeleton, getNavigation } from "@/features/shell"
import { requestPath } from "@/lib/request-path"

// First load: the (app) layout is still fetching nav/user, so show the whole shell as a skeleton.
// STATIC (B6 ruling I9, K1): no API call and no session lookup, so the fallback is instant. It never knows who the caller is: it shows the typical shell
// (every nav entry the seed lists, the assistant icon, the seed departments) and the page replaces it. Auth pages have their own loading.tsx; anything
// else without one (a not-found, the callback routes) gets the neutral PageSkeleton.
// Under /platform it is the console shell instead (D1, D2), filtered by the SEED operator's staff role (the real operator is only known to the page).
// Intended dimensions: AppShellSkeleton at its measured sizes (nav rows 9 + 2, user block 50px pill, topbar controls) around PageSkeleton; nothing new here.
export default async function Loading() {
  const path = await requestPath()
  if (path === "/platform" || path.startsWith("/platform/")) {
    const [nav, op, env] = await Promise.all([getPlatformNav(), getOperator(), getPlatformEnv()])
    return (
      <AppShellSkeleton departments={false} assistant={false} platform={{ menu: filterForStaff(nav.menu, op), env }}>
        <PageSkeleton />
      </AppShellSkeleton>
    )
  }
  if (!path || /^\/(?:sign-in|sign-up|forgot-password|verify-email|reset-password|onboarding)(?:\/|$)/.test(path)) return <PageSkeleton />
  const navigation = await getNavigation()
  return (
    <AppShellSkeleton departments={navigation.departments} assistant>
      <PageSkeleton />
    </AppShellSkeleton>
  )
}
