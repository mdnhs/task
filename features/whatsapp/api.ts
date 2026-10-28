import { getData } from "@/lib/data"
import type { Conversation, Integration, LinkTargets } from "./types"

// The integration setup is per tenant (each client confirms its own provider and flows); `default` covers new tenants.
export async function getWhatsapp(tenantId: string) {
  const [{ conversations }, integrations, targets] = await Promise.all([
    getData<{ conversations: Conversation[] }>("whatsapp/conversations.json"),
    getData<{ default: Integration; tenants: Record<string, Integration> }>("whatsapp/integration.json"),
    getData<LinkTargets>("whatsapp/link-targets.json"),
  ])
  return { conversations, integration: integrations.tenants[tenantId] ?? integrations.default, targets }
}
