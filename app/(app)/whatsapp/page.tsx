import type { Metadata } from "next"

import { WhatsappView, getWhatsapp } from "@/features/whatsapp"
import { AccessRestricted, getUser } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"

export const metadata: Metadata = { title: "WhatsApp · OpsDesk" }

export default async function Page() {
  const [session, org, user] = await Promise.all([getSession(), getOrg(), getUser()])
  if (!can(session.role, "whatsapp")) return <AccessRestricted moduleLabel="WhatsApp" />
  const { conversations, integration, targets } = await getWhatsapp(session.tenant.id)
  return (
    <WhatsappView
      conversations={conversations}
      integration={integration}
      targets={targets}
      today={org.today}
      tz={org.timezone}
      tzLabel={org.tzLabel}
      canWrite={canWrite(session, "whatsapp")}
      canCreateTasks={canWrite(session, "tasks")}
      actor={user.name}
      scopeKey={session.tenant.id}
    />
  )
}
