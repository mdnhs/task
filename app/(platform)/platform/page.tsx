import { OverviewView, getPlatformSeed } from "@/features/platform"
import { AccessRestricted } from "@/features/shell"
import { getSession } from "@/lib/session"

export default async function Page() {
  const session = await getSession()
  if (!session.role.platform) return <AccessRestricted moduleLabel="the Platform console" />
  return <OverviewView seed={await getPlatformSeed()} />
}
