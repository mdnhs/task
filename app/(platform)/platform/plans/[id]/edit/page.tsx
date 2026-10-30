import { notFound } from "next/navigation"

import { PlanEditView, getPlatformSeed, planFormData } from "@/features/platform"
import { getOrg } from "@/lib/org"

import { gate } from "../../../../gate"

// Only seeded plan ids exist, so an unknown id is a real 404 status (like settings/[tab]); a notFound() inside the page
// alone would come after loading.tsx has started streaming, with status 200.
export const dynamicParams = false

export async function generateStaticParams() {
  const { plans } = await getPlatformSeed()
  return plans.map((p) => ({ id: p.id }))
}

export const metadata = { title: "Edit plan · Platform · OpsDesk" }

// Edit plan (price, limits, modules). Gated on plans.write (owner, billing).
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const g = await gate("plans.write", "platform plan editing")
  if ("denied" in g) return g.denied
  const [{ id }, org] = await Promise.all([params, getOrg()])
  const seed = await getPlatformSeed()
  if (!seed.plans.some((p) => p.id === id)) notFound()
  return <PlanEditView data={planFormData(seed)} planId={id} operator={{ name: g.op.name, role: g.op.role }} today={org.today} />
}
