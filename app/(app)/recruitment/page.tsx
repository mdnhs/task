import { RecruitmentView, forRole, getCandidates } from "@/features/recruitment"
import { AccessRestricted, getUser } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"

export default async function Page() {
  const [session, org, user] = await Promise.all([getSession(), getOrg(), getUser()])
  if (!can(session.role, "recruitment")) return <AccessRestricted moduleLabel="Recruitment" />
  const write = canWrite(session, "recruitment")
  const { candidates, owners } = await getCandidates()
  return (
    <RecruitmentView
      // Candidate personal data (FR-REC-03) is stripped on the server for read-only roles and suspended tenants.
      candidates={forRole(candidates, write)}
      owners={owners}
      departments={org.departments}
      today={org.today}
      tz={org.timezone}
      tzLabel={org.tzLabel}
      canWrite={write}
      actor={user.name}
      scopeKey={`${session.tenant.id}:${write ? "w" : "r"}`}
    />
  )
}
