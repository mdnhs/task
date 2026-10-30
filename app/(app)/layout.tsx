import { redirect } from "next/navigation"

import { MfaGate } from "@/features/account"
import { AiAssistant, fillAssistant, getAssistant } from "@/features/assistant"
import { GlobalSearch } from "@/features/search"
import { DEFAULT_APPEARANCE, appearanceCss } from "@/lib/appearance"
import { BRAND_STYLE_ID, brandCss } from "@/lib/brand"
import { formatTime } from "@/lib/dates"
import { filterByEntitlement, hasProductModule } from "@/lib/entitlements"
import { getNotifyContext } from "@/lib/notify-data"
import { getPeople } from "@/lib/people"
import { todayUserId } from "@/lib/today-data"
import { getDeviceContext, getMfaState } from "@/lib/device-session"
import { getOrg } from "@/lib/org"
import { getPlatformNotice } from "@/lib/platform-notice-data"
import { PlatformNoticeBanner } from "@/components/platform-notice"
import { can, filterNav } from "@/lib/permissions"
import { getSession } from "@/lib/session"
import { AppShell, getNavigation, getNotifications, getUser } from "@/features/shell"

import "../styles/search.css"
import "../styles/devices.css"

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

  const [device, mfa, notice] = await Promise.all([getDeviceContext(session), getMfaState(session), getPlatformNotice(org.today)])
  // The bell's person (task change notices, FR-M1-12): the same directory person the Today card uses.
  const me = { tenantId: session.tenant.id, personId: todayUserId(session, await getPeople(), user.name) }
  const notify = await getNotifyContext(org, session.role, can(session.role, "reports", "write"), me)

  // Filtered on the server so hidden modules never reach the client payload.
  // session.role is already narrowed to the plan; filterByEntitlement states the plan check (FR-M0-15) on its own.
  const inPlan = <T extends { href: string }>(items: T[]) => filterByEntitlement(filterNav(items, session.role), session.entitlements)
  const nav = { ...navigation, menu: inPlan(navigation.menu), general: inPlan(navigation.general) }

  return (
    <>
    {/* Tenant brand + appearance tokens; the branding panel rewrites this tag for its live preview. */}
    <style id={BRAND_STYLE_ID} dangerouslySetInnerHTML={{ __html: brandCss(session.tenant.brand) + appearanceCss(session.tenant.appearance ?? DEFAULT_APPEARANCE) }} />
    <AppShell
      navigation={nav}
      user={user}
      session={{
        role: session.role,
        roles: session.roles,
        tenant: session.tenant,
        tenants: session.tenants,
        devices: { current: device.current.id, options: device.options.map((d) => ({ id: d.id, label: d.label })) },
      }}
      tzLabel={org.tzLabel}
      today={org.today}
      notifications={filterNav(notifications, session.role)}
      notify={notify}
      assistant={
        !hasProductModule(session.entitlements, session.entitlements.assistant) ? undefined : <AiAssistant
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
      {/* D10: the platform announcement (console Settings). Mock: read from the seed platform/settings.json, since a
          console save stays in the console's client store (lib/platform-notice-data.ts). */}
      <PlatformNoticeBanner notice={notice} today={org.today} tzLabel={org.tzLabel} />
      {/* AC-M0-02: when two-step verification is required and not set up, every page shows the setup gate instead. */}
      {mfa.gate ? <MfaGate account={user.email} /> : children}
    </AppShell>
    </>
  )
}
