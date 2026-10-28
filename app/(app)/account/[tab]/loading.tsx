import { AccountLoading, getNotificationPrefs, getSecurity } from "@/features/account"

// Async so the skeleton uses the real row counts; the client wrapper picks the tab from the pathname.
export default async function Loading() {
  const [security, prefs] = await Promise.all([getSecurity(), getNotificationPrefs()])
  return (
    <AccountLoading
      counts={{
        sessions: security.sessions.length,
        others: security.sessions.filter((s) => !s.current).length,
        activity: security.activity.length,
        events: prefs.events.length,
        channels: prefs.channels.length,
      }}
    />
  )
}
