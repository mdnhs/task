import { PayrollView, getPayroll } from "@/features/payroll"
import { AccessRestricted, getUser } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"

export default async function Page() {
  const [session, org, user] = await Promise.all([getSession(), getOrg(), getUser()])
  if (!can(session.role, "payroll")) return <AccessRestricted moduleLabel="Payroll Issues" />
  const { issues, directory } = await getPayroll()
  return (
    <PayrollView
      issues={issues}
      directory={directory}
      today={org.today}
      tz={org.timezone}
      tzLabel={org.tzLabel}
      canWrite={canWrite(session, "payroll")}
      actor={user.name}
      scopeKey={session.tenant.id}
    />
  )
}
