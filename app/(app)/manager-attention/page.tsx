import { AttentionView, getAttention } from "@/features/attention"
import { AccessRestricted, getUser } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"

export default async function Page() {
  const [session, org, user] = await Promise.all([getSession(), getOrg(), getUser()])
  if (!can(session.role, "attention")) return <AccessRestricted moduleLabel="Manager Attention" />
  const { items, outstanding } = await getAttention()
  return (
    <AttentionView
      items={items}
      outstanding={outstanding}
      today={org.today}
      tz={org.timezone}
      tzLabel={org.tzLabel}
      canWrite={canWrite(session, "attention")}
      actor={user.name}
      scopeKey={session.tenant.id}
    />
  )
}
