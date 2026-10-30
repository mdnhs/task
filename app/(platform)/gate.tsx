import { getOperator, requireStaff, type PlatformAction, type StaffMember } from "@/features/platform"
import { AccessRestricted } from "@/features/shell"
import { getSession } from "@/lib/session"

// Server gate for every console page (D3). Returns the "Access restricted" body when the session isn't the platform role,
// or when the operator's staff role lacks `action`; otherwise the operator. Pages return early, so no data loads for a denied page.
export async function gate(action: PlatformAction, label: string): Promise<{ denied: React.ReactNode } | { op: StaffMember }> {
  const session = await getSession()
  if (!session.role.platform) return { denied: <AccessRestricted moduleLabel="the Platform console" /> }
  const op = await getOperator()
  if (!requireStaff(op, action)) return { denied: <AccessRestricted moduleLabel={label} home={{ href: "/platform", label: "Back to Overview" }} /> }
  return { op }
}
