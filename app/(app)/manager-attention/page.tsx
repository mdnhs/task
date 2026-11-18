import { AttentionView, getAttention } from "@/features/attention"
import { AccessRestricted, getUser, mockGate } from "@/features/shell"
import { getMockOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"

// MOCK (I16, I18): the decide-and-carry-forward queue has no backend until a later phase, so it is shown only on a demo deployment (ENABLE_MOCK_MODULES=1). The dashboard card and the
// bell use the API's attention feed (FR-M1-79, GET /v1/attention).
export default async function Page() {
  const off = mockGate("Manager Attention")
  if (off) return off
  const [session, org, user] = await Promise.all([getSession(), getMockOrg(), getUser()])
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
