import { filterForStaff, getOperator, getPlatformEnv, getPlatformNav } from "@/features/platform"
import { AppShellSkeleton, PageSkeleton, getNavigation } from "@/features/shell"
import { filterByEntitlement, hasProductModule } from "@/lib/entitlements"
import { filterNav } from "@/lib/permissions"
import { requestPath } from "@/lib/request-path"
import { getSession } from "@/lib/session"

// First load: the (app) layout is still fetching nav/user, so show the whole shell as a skeleton.
// Departments come from the local nav JSON so the topbar filter skeleton matches the tenant's real pills.
// The topbar icons follow the same rules as the layout: the assistant needs its plan module, the WhatsApp shortcut
// follows the role- and plan-filtered nav. Under /platform (platform role) it is the console shell instead (D1, D2).
export default async function Loading() {
  const [navigation, session, path] = await Promise.all([getNavigation(), getSession(), requestPath()])
  if (session.role.platform && (path === "/platform" || path.startsWith("/platform/"))) {
    const [nav, op, env] = await Promise.all([getPlatformNav(), getOperator(), getPlatformEnv()])
    return (
      <AppShellSkeleton departments={false} assistant={false} whatsapp={false} platform={{ menu: filterForStaff(nav.menu, op), env }}>
        <PageSkeleton />
      </AppShellSkeleton>
    )
  }
  const menu = filterByEntitlement(filterNav(navigation.menu, session.role), session.entitlements)
  return (
    <AppShellSkeleton
      departments={navigation.departments}
      assistant={hasProductModule(session.entitlements, session.entitlements.assistant)}
      whatsapp={menu.some((n) => n.href === "/whatsapp")}
    >
      <PageSkeleton />
    </AppShellSkeleton>
  )
}
