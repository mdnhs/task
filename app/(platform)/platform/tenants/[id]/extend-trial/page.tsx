import { LiveExtendTrial, loadTenant360 } from "@/features/platform"
import { apiServer } from "@/lib/api/server"

import { gate } from "../../../../gate"
import { refused, settle } from "../../../../settle"
import { TenantNotFound } from "../t360"

export const metadata = { title: "Extend trial · Platform · OpsDesk" }

// The long form behind "Extend trial" (rule 31) on the API: owner and support; whole days 1 to 30 and a reason.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const g = await gate("tenants.suspend", "trial extensions")
  if ("denied" in g) return g.denied
  const { id } = await params
  const r = await settle(apiServer().then((api) => loadTenant360(api, id)))
  if (!r.ok) return refused(r.e, "trial extensions")
  return r.v ? <LiveExtendTrial t={r.v} /> : <TenantNotFound />
}
