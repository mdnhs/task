import { getPlatformNav } from "@/features/platform"
import { AppShellSkeleton, PageSkeleton, getNavigation } from "@/features/shell"
import { mockEnabled } from "@/lib/mock-registry"
import { requestPath } from "@/lib/request-path"

// First load: the (app) layout is still fetching nav/user, so show the whole shell as a skeleton.
// STATIC (B6 ruling I9, K1): no API call and no session lookup, so the fallback is instant. It never knows who the caller is: it shows the typical shell
// (every nav entry the seed lists, the assistant icon, the seed departments) and the page replaces it. Auth pages have their own loading.tsx; anything
// else without one (a not-found, the callback routes) gets the neutral PageSkeleton.
// Under /platform it is the console shell instead (D1, D2): the full static menu (the real operator's staff role is only known to the page), no Test / Live pill.
// Intended dimensions: AppShellSkeleton at its measured sizes (nav rows 9 + 2, user block 50px pill, topbar controls) around PageSkeleton; nothing new here.
export default async function Loading() {
  const path = await requestPath()
  if (path === "/platform" || path.startsWith("/platform/")) {
    const nav = await getPlatformNav()
    return (
      <AppShellSkeleton departments={false} assistant={false} platform={{ menu: nav.menu, env: undefined }}>
        <PageSkeleton />
      </AppShellSkeleton>
    )
  }
  if (!path || /^\/(?:sign-in|sign-up|forgot-password|verify-email|reset-password|onboarding)(?:\/|$)/.test(path)) return <PageSkeleton />
  const navigation = await getNavigation()
  // The mock-only entries and the assistant exist only on a demo deployment (ENABLE_MOCK_MODULES=1), same as the real shell.
  return (
    <AppShellSkeleton departments={navigation.departments} assistant={mockEnabled()} mock={mockEnabled()}>
      <PageSkeleton />
    </AppShellSkeleton>
  )
}
