import { redirect } from "next/navigation"

import { AiAssistant, fillAssistant, getAssistant } from "@/features/assistant"
import { GlobalSearch } from "@/features/search"
import { BRAND_STYLE_ID, brandCss } from "@/lib/brand"
import { formatTime } from "@/lib/dates"
import { getNotifyContext } from "@/lib/notify-data"
import { getOrg } from "@/lib/org"
import { can, filterNav } from "@/lib/permissions"
import { getSession } from "@/lib/session"
import { AppShell, getNavigation, getNotifications, getUser } from "@/features/shell"

import "../styles/search.css"

// Every signed-in page shares the shell (sidebar, topbar, AI assistant).
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session.signedIn) redirect("/sign-in")

  const [navigation, user, assistant, org, notifications] = await Promise.all([
    getNavigation(),
    getUser(),
    getAssistant(),
    getOrg(),
    getNotifications(),
  ])

  const notify = await getNotifyContext(org, session.role, can(session.role, "reports", "write"))

  // Filtered on the server so hidden modules never reach the client payload.
  const nav = { ...navigation, menu: filterNav(navigation.menu, session.role), general: filterNav(navigation.general, session.role) }

  return (
    <>
    {/* Tenant brand tokens; the branding panel rewrites this tag for its live preview. */}
    <style id={BRAND_STYLE_ID} dangerouslySetInnerHTML={{ __html: brandCss(session.tenant.brand) }} />
    <AppShell
      navigation={nav}
      user={user}
      session={{ role: session.role, roles: session.roles, tenant: session.tenant, tenants: session.tenants }}
      tzLabel={org.tzLabel}
      today={org.today}
      notifications={filterNav(notifications, session.role)}
      notify={notify}
      assistant={
        <AiAssistant
          key="assistant"
          data={fillAssistant(assistant, {
            firstName: user.name.split(" ")[0] ?? user.name,
            deadline: formatTime(`${org.today.slice(0, 10)}T${org.deadline}`),
            tz: org.tzLabel,
          })}
        />
      }
      // The search index loads lazily on first open (server action, role-filtered), so it's not in any page payload.
      search={<GlobalSearch key="search" departments={navigation.departments.map((d) => d.dep)} today={org.today} />}
    >
      {children}
    </AppShell>
    </>
  )
}
