import { unavailablePlatformPage } from "@/features/platform"

import { gate } from "../../../../gate"
import { Unavailable } from "../../../../unavailable"
import { MockFormBody, MockNotInSeed, loadMock360 } from "../t360"

export const metadata = { title: "Scheduled deletion · Platform · OpsDesk" }

// MOCK (I16): no platform API behind it. A tenant 360 long form (rule 31) on the seed, shown only with ENABLE_MOCK_MODULES=1.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const g = await gate("tenants.lifecycle", "scheduled deletion")
  if ("denied" in g) return g.denied
  if (unavailablePlatformPage()) return <Unavailable label="Scheduled deletion" />
  const { id } = await params
  const v = await loadMock360(id, g.op)
  return v ? <MockFormBody page="schedule-deletion" v={v} /> : <MockNotInSeed />
}
