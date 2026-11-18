import { WhatsAppManageSkeleton } from "@/features/whatsapp"
import { PageSkeleton } from "@/features/shell"
import { mockEnabled } from "@/lib/mock-registry"

// Static (no data read): the skeleton shows the typical first visit, WhatsApp off. The page is the unavailable state without the demo flag, so the generic skeleton.
export default function Loading() {
  if (!mockEnabled()) return <PageSkeleton />
  return <WhatsAppManageSkeleton />
}
