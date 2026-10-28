import { TenantDetail, getPlatformSeed } from "@/features/platform"
import { AccessRestricted } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { getSession } from "@/lib/session"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session, org] = await Promise.all([params, getSession(), getOrg()])
  if (!session.role.platform) return <AccessRestricted moduleLabel="the Platform console" />
  return <TenantDetail seed={await getPlatformSeed()} id={id} today={org.today} tzLabel={org.tzLabel} actor={session.role.label} />
}
