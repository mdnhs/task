import { DataRequestsView, dataRequestsData, getPlatformSeed, isDataView } from "@/features/platform"
import { getOrg } from "@/lib/org"

import { gate } from "../../gate"

export const metadata = { title: "Data requests · Platform · OpsDesk" }

// The GDPR requests queue (Task 8, FR-M0-19). Gated on data.requests (owner, support); `?view=` picks a saved view (default Open);
// `?q=` prefills the search (the ⌘K palette links a request this way).
// The view model carries request metadata plus tenant names and deletion dates, never a person's data (D8).
export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string | string[]; q?: string | string[] }> }) {
  const g = await gate("data.requests", "platform data requests")
  if ("denied" in g) return g.denied
  const [seed, org, { view, q }] = await Promise.all([getPlatformSeed(), getOrg(), searchParams])
  return <DataRequestsView data={dataRequestsData(seed)} view={isDataView(view) ? view : "open"} q={typeof q === "string" ? q.slice(0, 100) : ""} today={org.today} operator={{ name: g.op.name, role: g.op.role }} />
}
