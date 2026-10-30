import { gate } from "../../../../gate"
import { FORM_ACTION, FORM_LABEL, FormBody, TenantNotFound, load360 } from "../t360"

export const metadata = { title: "Schedule deletion · Platform · OpsDesk" }

// A tenant 360 long form (rule 31). Gated on its own action (D3); the form writes a store patch and a D7 audit line.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const g = await gate(FORM_ACTION["schedule-deletion"], FORM_LABEL["schedule-deletion"])
  if ("denied" in g) return g.denied
  const { id } = await params
  const v = await load360(id, g.op)
  if (!v) return <TenantNotFound />
  return <FormBody page="schedule-deletion" v={v} />
}
