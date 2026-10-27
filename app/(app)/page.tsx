import { DashboardView, getDashboard } from "@/features/dashboard"

export default async function Page() {
  const dashboard = await getDashboard()
  return <DashboardView data={dashboard} />
}
