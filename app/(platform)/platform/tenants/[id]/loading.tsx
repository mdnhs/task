import { DeniedSkeleton, TENANT_TABS, Tenant360Skeleton, tabAction } from "@/features/platform"
import { requireStaff } from "@/features/platform"
import { AccessRestricted } from "@/features/shell"

import { gate } from "../../../gate"
import { FORM_ACTION, FormBody, Header, TabBody, TenantNotFound, isFormPage, isTenantTab, load360, pathParts } from "./t360"

// Entering a tenant from elsewhere (the list, search, a link): the real header and tab, or the long-form page, masked
// (SkMask), from the same gate and view model as the routes. Switching tabs inside the 360 uses [tab]/loading.tsx.
export default async function Loading() {
  const g = await gate("tenants.read", "platform tenants")
  if ("denied" in g) return <DeniedSkeleton />
  const { id, rest } = await pathParts()
  const v = id ? await load360(id, g.op) : null
  if (!v) return <TenantNotFound />
  if (isFormPage(rest)) {
    if (!requireStaff(g.op, FORM_ACTION[rest])) return <DeniedSkeleton />
    return <Tenant360Skeleton><FormBody page={rest} v={v} /></Tenant360Skeleton>
  }
  const tab = isTenantTab(rest) ? rest : "overview"
  return (
    <Tenant360Skeleton>
      <Header v={v} />
      {requireStaff(g.op, tabAction(tab)) ? (
        <TabBody tab={tab} v={v} />
      ) : (
        // The same body the tab page's gate returns (app/(platform)/gate.tsx), so the skeleton matches.
        <AccessRestricted moduleLabel={`tenant ${TENANT_TABS.find((x) => x.id === tab)!.label.toLowerCase()}`} home={{ href: "/platform", label: "Back to Overview" }} />
      )}
    </Tenant360Skeleton>
  )
}
