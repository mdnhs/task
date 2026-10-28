import { SupportView, getPlatformSeed } from "@/features/platform"
import { AccessRestricted } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { getSession } from "@/lib/session"

export default async function Page() {
  const [session, org] = await Promise.all([getSession(), getOrg()])
  if (!session.role.platform) return <AccessRestricted moduleLabel="the Platform console" />
  return <SupportView seed={await getPlatformSeed()} today={org.today} tz={org.timezone} tzLabel={org.tzLabel} actor={session.role.label} />
}
