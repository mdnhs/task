import { ShiftsView, getShifts } from "@/features/shifts"
import { AccessRestricted } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { ME_ID } from "@/lib/people"
import { shiftScope } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"

// Shifts (FR-M1-20/21, FR-M0-07). Write roles edit everyone; staff-home readers get only their own shifts, cut on the server.
export default async function Page() {
  const [session, org] = await Promise.all([getSession(), getOrg()])
  const scope = shiftScope(session.role)
  if (scope === "none") return <AccessRestricted moduleLabel="Shifts" />
  const data = await getShifts(scope, ME_ID)
  return (
    <ShiftsView
      data={data}
      today={org.today}
      tz={org.timezone}
      tzLabel={org.tzLabel}
      canWrite={scope === "all" && canWrite(session, "shifts")}
      scopeKey={`${session.tenant.id}:${session.role.id}`}
    />
  )
}
