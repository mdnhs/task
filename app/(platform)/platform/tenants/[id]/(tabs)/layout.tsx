import { gate } from "../../../../gate"
import { Header, TenantNotFound, load360 } from "../t360"

// The tenant 360 shell (D9): the header and the tab seg stay mounted while the tab routes below it change, so the
// seg pill slides and only the tab body shows its skeleton ([tab]/loading.tsx). Gated on tenants.read.
export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const g = await gate("tenants.read", "platform tenants")
  if ("denied" in g) return g.denied
  const { id } = await params
  const v = await load360(id, g.op)
  if (!v) return <TenantNotFound />
  return (
    <>
      <Header v={v} />
      {children}
    </>
  )
}
