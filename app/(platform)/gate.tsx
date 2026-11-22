import { MfaGate, MfaStepUp } from "@/features/account"
import { getOperator, requireStaff, type PlatformAction, type StaffMember } from "@/features/platform"
import { AccessRestricted } from "@/features/shell"
import { getPlatformSession } from "@/lib/session"

// Server gate for every console page (D3). Returns the "Access restricted" body when the caller is not active platform staff or the staff role lacks `action`, and the second-factor gate
// (the same one a company page gets) while the factor is outstanding: the API refuses every /v1/platform read with 401 mfa_* then, so nothing is asked. Pages return early, so no data
// loads for a denied page. The operator is the signed-in user (/v1/me.platformRole).
export async function gate(action: PlatformAction, label: string): Promise<{ denied: React.ReactNode } | { op: StaffMember }> {
  const session = await getPlatformSession()
  if (!session.platformRole) return { denied: <AccessRestricted moduleLabel="the Platform console" /> }
  if (session.mfa !== "ok") return { denied: session.mfa === "enrol" ? <MfaGate account={session.user.email} who="staff" /> : <MfaStepUp account={session.user.email} /> }
  const op = await getOperator()
  if (!op) return { denied: <AccessRestricted moduleLabel="the Platform console" /> }
  if (!requireStaff(op, action)) return { denied: <AccessRestricted moduleLabel={label} home={{ href: "/platform", label: "Back to Overview" }} /> }
  return { op }
}
