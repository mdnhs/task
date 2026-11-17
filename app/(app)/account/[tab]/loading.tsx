import { AccountLoading, getNotificationPrefs } from "@/features/account"

// The skeleton never calls the API (B6 I9): the Security tab shows the typical case, the current session plus one other and two sign-ins.
// The profile and notification tabs still read their mock files for exact row counts.
export default async function Loading() {
  const prefs = await getNotificationPrefs()
  return (
    <AccountLoading
      counts={{
        sessions: 2,
        others: 1,
        activity: 2,
        events: prefs.events.length,
        channels: prefs.channels.length,
        prefs: { channels: prefs.channels, events: prefs.events },
      }}
    />
  )
}
