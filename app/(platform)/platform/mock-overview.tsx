import { OverviewDashboard, getPlatformSeed, overviewData, type StaffMember } from "@/features/platform"
import { getMockOrg } from "@/lib/org"

// MOCK (I16): sample plan mix, recent activity and MRR history from public/data/platform. Rendered only on a demo deployment (the page passes it as children of LiveOverview, which shows
// children only when its `mock` flag is set), under a clear label, because none of it comes from the API.
export async function MockOverview({ op }: { op: StaffMember }) {
  const { unavailablePlatformPage } = await import("@/features/platform")
  if (unavailablePlatformPage()) return null
  const [seed, org] = await Promise.all([getPlatformSeed(), getMockOrg()])
  return (
    <section className="pf-sample" aria-label="Sample data">
      <p className="pf-note pf-note-info">Sample data: MRR history, plan mix and activity have no API yet.</p>
      <OverviewDashboard sample data={overviewData(seed, org.today, op)} today={org.today} tzLabel={org.tzLabel} />
    </section>
  )
}
