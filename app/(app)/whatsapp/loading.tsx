import { WhatsappSkeleton, getWhatsapp } from "@/features/whatsapp"
import { PageSkeleton } from "@/features/shell"
import { can } from "@/lib/permissions"
import { getSession } from "@/lib/session"

// Async so the skeleton uses the tenant's real integration card shape and conversation count (loading.tsx gets no params).
export default async function Loading() {
  const session = await getSession()
  if (!can(session.role, "whatsapp")) return <PageSkeleton />
  const { conversations, integration } = await getWhatsapp(session.tenant.id)
  return (
    <WhatsappSkeleton
      conversations={conversations.length}
      disconnected={integration.status === "disconnected" && !!integration.error}
      noteLines={integration.note.length > 115 ? 2 : 1}
      alertLines={integration.error ? Math.ceil((integration.error.detail.length + 40) / 120) : 1}
    />
  )
}
