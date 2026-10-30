import { BillingLedger, billingData, getPlatformSeed, getPlatformSettings, isBillingView } from "@/features/platform"
import { getOrg } from "@/lib/org"

import { gate } from "../../gate"

export const metadata = { title: "Billing · Platform · OpsDesk" }

// The billing ledger and dunning queue (D2, Task 6). Gated on billing.read; the actions need billing.write. The view
// model (billing.ts) carries invoices with tenant names and payment state only. `?view=` picks a saved view; `?q=` prefills the search (the ⌘K palette links invoices this way).
export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string | string[]; q?: string | string[] }> }) {
  const g = await gate("billing.read", "platform billing")
  if ("denied" in g) return g.denied
  const [seed, settings, org, { view, q }] = await Promise.all([getPlatformSeed(), getPlatformSettings(), getOrg(), searchParams])
  return (
    <BillingLedger
      data={billingData(seed, g.op, settings.payments)}
      view={isBillingView(view) ? view : "all"}
      q={typeof q === "string" ? q.slice(0, 100) : ""}
      today={org.today}
      tzLabel={org.tzLabel}
      operator={{ name: g.op.name, role: g.op.role }}
    />
  )
}
