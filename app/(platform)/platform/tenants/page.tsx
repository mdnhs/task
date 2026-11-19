import { LiveTenants, TENANTS_PAGE, isLiveView, loadTenantList, requireStaff } from "@/features/platform"
import { apiServer } from "@/lib/api/server"

import { gate } from "../../gate"
import { refused, settle } from "../../settle"

export const metadata = { title: "Tenants · Platform · OpsDesk" }

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined)

// The tenants list on the API (B6 T6.8): metadata only (no member names or emails). `?page=` and `?q=` go to the API (server paging); `?view=` is a saved view of the loaded page.
export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string | string[]; page?: string | string[]; q?: string | string[] }> }) {
  const g = await gate("tenants.read", "platform tenants")
  if ("denied" in g) return g.denied
  const sp = await searchParams
  const view = one(sp.view)
  const q = (one(sp.q) ?? "").slice(0, 100)
  const page = Math.max(1, Math.floor(Number(one(sp.page))) || 1)
  const r = await settle(apiServer({ tenant: null }).then((api) => loadTenantList(api, { q: q || undefined, page, pageSize: TENANTS_PAGE })))
  if (!r.ok) return refused(r.e, "platform tenants")
  return <LiveTenants data={r.v} view={isLiveView(view) ? view : "all"} q={q} can={{ suspend: requireStaff(g.op, "tenants.suspend"), support: requireStaff(g.op, "support.request"), revenue: requireStaff(g.op, "billing.read") }} />
}
