import type { Metadata } from "next"

import { WhatsAppError, WhatsAppManageView, getWhatsApp } from "@/features/whatsapp"
import { AccessRestricted, mockGate } from "@/features/shell"
import { can } from "@/lib/permissions"
import { getOrg } from "@/lib/org"
import { canWrite, requireMfaOk } from "@/lib/session"

export const metadata: Metadata = { title: "WhatsApp · Integrations · Settings · OpsDesk" }

// MOCK (no backend yet, demo flag only): manage WhatsApp notifications. Reached from the WhatsApp card on Settings -> Integrations.
export default async function Page() {
  const off = mockGate("WhatsApp")
  if (off) return off
  const session = await requireMfaOk()
  if (!can(session.role, "settings")) return <AccessRestricted moduleLabel="Settings" />
  const [org, wa] = await Promise.all([getOrg(), getWhatsApp().catch(() => null)])
  if (!wa) return <WhatsAppError />
  return <WhatsAppManageView initial={wa} scope={session.tenant.id} today={org.today} tzLabel={org.tzLabel} canWrite={canWrite(session, "settings")} />
}
