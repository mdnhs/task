import { getPlatformNav } from "@/features/platform"
import { AppShell, getUser } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { getSession } from "@/lib/session"

// The Platform Super Admin console: same shell, its own navigation, no department filter (it spans every company).
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const [navigation, user, session, org] = await Promise.all([getPlatformNav(), getUser(), getSession(), getOrg()])
  const allowed = !!session.role.platform
  // Other roles get the restricted page without the console's navigation. The operator isn't inside a company, so no tenant banner.
  const nav = allowed ? navigation : { ...navigation, menu: [], general: [] }

  return (
    <AppShell
      navigation={nav}
      user={user}
      session={{ role: session.role, roles: session.roles, tenant: { ...session.tenant, status: "active" }, tenants: session.tenants }}
      tzLabel={org.tzLabel}
      today={org.today}
      notifications={[]}
      departments={false}
    >
      {children}
    </AppShell>
  )
}
