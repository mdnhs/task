import { redirect } from "next/navigation"

import { tenantPath } from "@/features/platform"

import { gate } from "../../../gate"

// The tenant 360 opens on its overview tab (D9). Gated first, so a denied role gets "Access restricted" and no redirect.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const g = await gate("tenants.read", "platform tenants")
  if ("denied" in g) return g.denied
  const { id } = await params
  redirect(tenantPath(id))
}
