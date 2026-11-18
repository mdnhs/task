import { OrdersView, getOrders } from "@/features/orders"
import { AccessRestricted, getUser, mockGate } from "@/features/shell"
import { getMockOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"

export default async function Page() {
  const off = mockGate("Orders & Stock")
  if (off) return off
  const [session, org, user] = await Promise.all([getSession(), getMockOrg(), getUser()])
  if (!can(session.role, "orders")) return <AccessRestricted moduleLabel="Orders & Stock" />
  const orders = await getOrders()
  return (
    <OrdersView
      orders={orders}
      departments={org.departments}
      today={org.today}
      tz={org.timezone}
      tzLabel={org.tzLabel}
      currency={org.currency}
      locale={org.locale}
      canWrite={canWrite(session, "orders")}
      actor={user.name}
      scopeKey={session.tenant.id}
    />
  )
}
