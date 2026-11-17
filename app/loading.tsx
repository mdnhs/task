import { filterForStaff, getOperator, getPlatformEnv, getPlatformNav } from "@/features/platform"
import { AppShellSkeleton, PageSkeleton, getNavigation } from "@/features/shell"
import { filterByEntitlement, hasProductModule } from "@/lib/entitlements"
import { filterNav } from "@/lib/permissions"
import { requestPath } from "@/lib/request-path"
import { peekPlatformSession, peekSession } from "@/lib/session"

// First load: the (app) layout is still fetching nav/user, so show the whole shell as a skeleton.
// Departments come from the local nav JSON so the topbar filter skeleton matches the tenant's real pills.
// The topbar icons follow the same rules as the layout: the assistant needs its plan module.
// Under /platform (platform role) it is the console shell instead (D1, D2).
export default async function Loading() {
  const path = await requestPath()
  const underConsole = path === "/platform" || path.startsWith("/platform/")
  // A fallback never redirects (peek*): signed out, expired or no company shows the neutral skeleton, and the page itself redirects.
  const [navigation, session] = await Promise.all([getNavigation(), underConsole ? peekPlatformSession() : peekSession()])
  if (!session) return <PageSkeleton />
  if (underConsole && session.role.platform) {
    const [nav, op, env] = await Promise.all([getPlatformNav(), getOperator(), getPlatformEnv()])
    return (
      <AppShellSkeleton departments={false} assistant={false} platform={{ menu: filterForStaff(nav.menu, op), env }}>
        <PageSkeleton />
      </AppShellSkeleton>
    )
  }
  const menu = filterByEntitlement(filterNav(navigation.menu, session.role), session.entitlements)
  return (
    <AppShellSkeleton
      departments={navigation.departments}
      assistant={hasProductModule(session.entitlements, session.entitlements.assistant)}
    >
      <PageSkeleton />
    </AppShellSkeleton>
  )
}
