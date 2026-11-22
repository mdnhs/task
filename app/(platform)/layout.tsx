import { platformSearchIndex } from "@/app/actions/platform-search"
import { MfaGate, MfaStepUp } from "@/features/account"
import { STAFF_ROLE_LABEL, filterForStaff, getOperator, getPlatformNav, loadEnv, nowUtc, requireStaff } from "@/features/platform"
import { GlobalSearch } from "@/features/search"
import { AppShell, getUser } from "@/features/shell"
import { initialsOf } from "@/lib/branding"
import { apiServer } from "@/lib/api/server"
import { getPlatformSession } from "@/lib/session"

import "../styles/search.css"

// The Platform console (D1): the shared shell in its platform variant: grouped navigation (D2) filtered by the operator's staff role (D3), the signed-in staff member as the user, and the
// Test / Live pill from the billing settings (owner only). B6 T6.8: the operator and the second factor come from the API. Anyone who is not active staff gets the restricted page without the
// console's navigation or search; staff whose second factor is outstanding get the gate instead of the page (as a company page does), and nothing platform-side is asked meanwhile.
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  // Real check (proxy.ts only looks for a cookie): active staff need no company; anyone else gets the restricted page or /onboarding.
  const session = await getPlatformSession()
  const op = await getOperator()
  const mfaOk = session.mfa === "ok"
  const [navigation, env] = await Promise.all([getPlatformNav(), op && mfaOk ? loadEnv(await apiServer({ tenant: null })) : null])
  const nav = op ? { ...navigation, menu: filterForStaff(navigation.menu, op) } : { ...navigation, menu: [], general: [] }
  // Only staff see their staff identity; anyone else keeps their own on the restricted page.
  const user = op ? { name: op.name, role: `${STAFF_ROLE_LABEL[op.role]} · Platform staff`, email: op.email, initials: initialsOf(op.name) } : await getUser()

  return (
    <AppShell
      variant="platform"
      env={env ?? undefined}
      bellScope={`platform:${op?.id ?? "none"}`}
      // B8 Task 24: the API's bell for active staff past their second factor; anyone else (the restricted page) gets no bell at all.
      bell={op && mfaOk ? "platform" : "none"}
      navigation={nav}
      user={user}
      // The operator isn't inside a company, so no tenant banner.
      session={{ role: session.role, roles: session.roles, tenant: { ...session.tenant, status: "active" }, tenants: session.tenants }}
      tzLabel="UTC"
      today={nowUtc()}
      notifications={[]}
      departments={false}
      search={op && mfaOk ? <GlobalSearch key="search" scope="platform" load={platformSearchIndex} departments={[]} today={nowUtc()} placeholder={requireStaff(op, "billing.read") ? "Search tenants and pages…" : "Search tenants, pages…"} /> : undefined}
    >
      {op && session.mfa === "enrol" ? <MfaGate account={session.user.email} who="staff" /> : op && session.mfa === "challenge" ? <MfaStepUp account={session.user.email} /> : children}
    </AppShell>
  )
}
