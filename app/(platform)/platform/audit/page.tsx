import { AuditLogView, auditLogData, getPlatformSeed } from "@/features/platform"
import { getOrg } from "@/lib/org"

import { gate } from "../../gate"

export const metadata = { title: "Audit log · Platform · OpsDesk" }

// The platform audit log (Task 9, FR-SAAS-10): read only, filters, row details and CSV. Gated on audit.read (every role
// has it). The view model is the log plus tenant names for the filter, nothing else from a tenant record (D8).
export default async function Page() {
  const g = await gate("audit.read", "the platform audit log")
  if ("denied" in g) return g.denied
  const [seed, org] = await Promise.all([getPlatformSeed(), getOrg()])
  return <AuditLogView data={auditLogData(seed)} today={org.today} tzLabel={org.tzLabel} />
}
