import { DeniedSkeleton, Tenant360Skeleton } from "@/features/platform"

import { gate } from "../../../../gate"
import { FORM_ACTION, FORM_LABEL, FormBody, TenantNotFound, load360, pathParts } from "../t360"

// The real form, masked, from the same gate and view model as the page.
export default async function Loading() {
  const g = await gate(FORM_ACTION["extend-trial"], FORM_LABEL["extend-trial"])
  if ("denied" in g) return <DeniedSkeleton />
  const { id } = await pathParts()
  const v = id ? await load360(id, g.op) : null
  if (!v) return <TenantNotFound />
  return <Tenant360Skeleton label="Loading form"><FormBody page="extend-trial" v={v} /></Tenant360Skeleton>
}
