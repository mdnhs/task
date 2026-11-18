import { AccountLoading } from "@/features/account"
import { PREF_CHANNELS, PREF_KINDS } from "@/features/account/adapters"
import { WhatsAppAccountSkeleton } from "@/features/whatsapp"
import { mockEnabled } from "@/lib/mock-registry"

// Static (B6 I9): never reads the session or the API. The Security tab shows the typical case (the current session plus one other, two sign-ins, no "Enter code");
// the notification table is the API's fixed set of kinds and channels.
export default function Loading() {
  return (
    <AccountLoading
      extras={mockEnabled() ? { notifications: <WhatsAppAccountSkeleton /> } : undefined} // the mock WhatsApp section (demo flag only)
      counts={{
        sessions: 2,
        others: 1,
        activity: 2,
        events: PREF_KINDS.length,
        channels: PREF_CHANNELS.length,
        prefs: { channels: PREF_CHANNELS, events: PREF_KINDS.map((k) => ({ id: k.kind, label: k.label, hint: k.hint })) },
      }}
    />
  )
}
