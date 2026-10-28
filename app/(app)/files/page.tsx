import { FilesView, getFiles } from "@/features/files"
import { AccessRestricted, getUser } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"

export default async function Page() {
  const [session, org, user] = await Promise.all([getSession(), getOrg(), getUser()])
  if (!can(session.role, "files")) return <AccessRestricted moduleLabel="Employee & Client Files" />
  const { documents, clients } = await getFiles()
  return (
    <FilesView
      documents={documents}
      clients={clients}
      today={org.today}
      tz={org.timezone}
      tzLabel={org.tzLabel}
      canWrite={canWrite(session, "files")}
      actor={user.name}
      scopeKey={session.tenant.id}
    />
  )
}
