import { redirect } from "next/navigation"

import { platformSearchIndex } from "@/app/actions/platform-search"
import { STAFF_ROLE_LABEL, filterForStaff, requireStaff, getOperator, getPlatformEnv, getPlatformNav, getPlatformSeed, platformAlerts } from "@/features/platform"
import { GlobalSearch } from "@/features/search"
import { AppShell, getUser } from "@/features/shell"
import { initialsOf } from "@/lib/branding"
import { getOrg } from "@/lib/org"
import { getSession } from "@/lib/session"

import "../styles/search.css"

// The Platform console (D1): the shared shell in its platform variant: grouped navigation (D2) filtered by the operator's
// staff role (D3), the operator from platform/staff.json as the user, platform alerts in the bell and the platform search index.
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session.signedIn) redirect("/sign-in")
  const allowed = !!session.role.platform
  const [navigation, org, op, env] = await Promise.all([getPlatformNav(), getOrg(), getOperator(), getPlatformEnv()])
  // Other roles get the restricted page without the console's navigation, alerts or search.
  const nav = allowed ? { ...navigation, menu: filterForStaff(navigation.menu, op) } : { ...navigation, menu: [], general: [] }
  const seed = allowed ? await getPlatformSeed() : null
  // Only the platform role sees the operator; anyone else keeps their own identity on the restricted page.
  const user = allowed ? { name: op.name, role: `${STAFF_ROLE_LABEL[op.role]} · Platform staff`, email: op.email, initials: initialsOf(op.name) } : await getUser()

  return (
    <AppShell
      variant="platform"
      env={allowed ? env : undefined}
      // Platform alerts keep their own read state per operator, apart from any tenant's bell.
      bellScope={`platform:${op.id}`}
      navigation={nav}
      user={user}
      // The operator isn't inside a company, so no tenant banner.
      session={{ role: session.role, roles: session.roles, tenant: { ...session.tenant, status: "active" }, tenants: session.tenants }}
      tzLabel={org.tzLabel}
      today={org.today}
      // Each alert links to a console page; it shows only when the operator may open that page.
      notifications={seed ? filterForStaff(platformAlerts(seed.tenants, seed.requests, org.today), op) : []}
      departments={false}
      search={allowed ? <GlobalSearch key="search" scope="platform" load={platformSearchIndex} departments={[]} today={org.today} placeholder={requireStaff(op, "billing.read") ? "Search tenants, invoices, pages…" : "Search tenants, pages…"} /> : undefined}
    >
      {children}
    </AppShell>
  )
}
