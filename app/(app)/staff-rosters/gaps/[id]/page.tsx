import { notFound } from "next/navigation"

import { GapPage, getRosters } from "@/features/staff-rosters"
import { AccessRestricted, getUser } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"

const decode = (id: string) => {
  try {
    return decodeURIComponent(id)
  } catch {
    return id // malformed escape: look the raw value up, it simply will not be found
  }
}

// One roster gap (was the side sheet on the Roster gaps tab). Next 16: `params` is a Promise. Same data, sensitivity rule
// (FR-STAFF-03) and scopeKey as /staff-rosters, so cover updates made here show on the list. Unknown id: notFound() (the
// not-found page; the status stays 200 because loading.tsx has already streamed, like /tasks/[ref]).
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session, org, user] = await Promise.all([params, getSession(), getOrg(), getUser()])
  if (!can(session.role, "staff")) return <AccessRestricted moduleLabel="Staff & Rosters" />
  const gid = decode(id)
  const sensitive = can(session.role, "staff", "write")
  const { gaps, staff } = await getRosters(sensitive)
  if (!gaps.some((g) => g.id === gid)) notFound()
  return (
    <GapPage
      id={gid}
      gaps={gaps}
      staff={staff}
      today={org.today}
      tz={org.timezone}
      tzLabel={org.tzLabel}
      canWrite={canWrite(session, "staff")}
      sensitive={sensitive}
      actor={user.name}
      scopeKey={`${session.tenant.id}:${session.role.id}`}
    />
  )
}
