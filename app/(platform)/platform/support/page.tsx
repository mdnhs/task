import { SupportView, getPlatformSeed, supportData } from "@/features/platform"
import { getOrg } from "@/lib/org"

import { gate } from "../../gate"

export const metadata = { title: "Support access · Platform · OpsDesk" }

// Support access requests and sessions. Gated on support.request (owner, support). The view model is cut on the server
// (features/platform/support.ts): tenant names, the requests and, with audit.read, the support-access audit lines only.
export default async function Page({ searchParams }: { searchParams: Promise<{ request?: string | string[] }> }) {
  const g = await gate("support.request", "platform support access")
  if ("denied" in g) return g.denied
  const [seed, org, { request }] = await Promise.all([getPlatformSeed(), getOrg(), searchParams])
  return (
    <SupportView
      data={supportData(seed, g.op)}
      operator={{ name: g.op.name, role: g.op.role }}
      today={org.today}
      tz={org.timezone}
      tzLabel={org.tzLabel}
      requestFor={typeof request === "string" ? request : undefined}
    />
  )
}
