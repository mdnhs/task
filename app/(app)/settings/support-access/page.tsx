import type { Metadata } from "next"

import { SupportAccessView, loadGrants, serverApi } from "@/features/settings"
import { AccessRestricted, apiFailureView } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { requireMfaOk } from "@/lib/session"

export const metadata: Metadata = { title: "Support access · Settings · OpsDesk" }

// The page the "support access granted" notification links to. Owner or admin may read the grants; only the owner revokes (the API decides).
export default async function Page() {
  const session = await requireMfaOk() // this page calls the API: second factor first
  const role = session.role.id
  if (role !== "owner" && role !== "admin") return <AccessRestricted moduleLabel="Settings" />
  const org = await getOrg()
  let grants
  try {
    grants = await loadGrants(await serverApi(), org.timezone)
  } catch (e) {
    const gate = apiFailureView(e, "Settings")
    if (gate) return gate
    throw e
  }
  return <SupportAccessView grants={grants} today={org.today} tzLabel={org.tzLabel} canRevoke={role === "owner" && session.tenant.status !== "suspended"} />
}
