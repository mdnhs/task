import { MfaGate, MfaStepUp } from "@/features/account"
import { AiAssistant, fillAssistant, getAssistant } from "@/features/assistant"
import { GlobalSearch } from "@/features/search"
import { DEFAULT_APPEARANCE, appearanceCss } from "@/lib/appearance"
import { BRAND_STYLE_ID, brandCss } from "@/lib/brand"
import { formatTime } from "@/lib/dates"
import { filterByEntitlement, hasProductModule } from "@/lib/entitlements"
import { getOrg, neutralOrg } from "@/lib/org"
import { getPlatformNotice } from "@/lib/platform-notice-data"
import { BillingBanner } from "@/components/billing-banner"
import { canOpenBilling } from "@/lib/billing-state"
import { PlatformNoticeBanner } from "@/components/platform-notice"
import { filterNav } from "@/lib/permissions"
import { getSession } from "@/lib/session"
import { AppShell, getNavigation, getUser } from "@/features/shell"

import "../styles/search.css"
import "../styles/devices.css"

// Every signed-in page shares the shell (sidebar, topbar, AI assistant).
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The real check (proxy.ts only looked for a cookie): getSession() asks the API who this is and redirects a signed-out, expired or company-less caller.
  const session = await getSession()

  // Tenant data is only readable once the second factor is in order (the API answers 401 mfa_* otherwise); until then the gate renders and nothing is asked.
  const [navigation, user, assistant, org] = await Promise.all([getNavigation(), getUser(), getAssistant(), session.mfa === "ok" ? getOrg() : neutralOrg()])

  const notice = await getPlatformNotice(org.today)

  // Filtered on the server so hidden modules never reach the client payload.
  // session.role is already narrowed to the plan; filterByEntitlement states the plan check (FR-M0-15) on its own.
  const inPlan = <T extends { href: string }>(items: T[]) => filterByEntitlement(filterNav(items, session.role), session.entitlements)
  // The department filter is the company's own departments (GET /v1/teams?kind=department), not the seed file's.
  const nav = { ...navigation, menu: inPlan(navigation.menu), general: inPlan(navigation.general), departments: [{ dep: "all", label: "All" }, ...org.departments.map((d) => ({ dep: d, label: d }))] }

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
        device: { label: session.device.label, registered: session.device.id !== null },
      }}
      tzLabel={org.tzLabel}
      today={org.today}
      notifications={[]}
      bellTimezone={session.mfa === "ok" ? org.timezone : undefined}
      banner={
        <BillingBanner
          status={session.tenant.status}
          billingState={session.billingState}
          canBilling={canOpenBilling(session)}
          trialEndsAt={session.trialEndsAt}
          graceEndsAt={session.graceEndsAt}
          timezone={org.timezone}
          tzLabel={org.tzLabel}
        />
      }
      assistant={
        !hasProductModule(session.entitlements, session.entitlements.assistant) ? undefined : <AiAssistant
          key="assistant"
          data={fillAssistant(assistant, {
            firstName: user.name.split(" ")[0] ?? user.name,
            deadline: org.deadline ? formatTime(`${org.today.slice(0, 10)}T${org.deadline}`) : "",
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
      {/* AC-M0-02: when two-step verification is required and not set up, every page shows the setup gate instead; a sign-in that has not passed its
          code step (R14) shows the step-up. Both mirror the API's 401 mfa_enrolment_required / mfa_challenge, so no page data is rendered meanwhile. */}
      {session.mfa === "enrol" ? <MfaGate account={user.email} /> : session.mfa === "challenge" ? <MfaStepUp account={user.email} /> : children}
    </AppShell>
    </>
  )
}
