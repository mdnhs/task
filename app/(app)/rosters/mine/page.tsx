import { MyRosterView, loadExchanges, loadLeaveQueue, loadMyRoster, loadRosterPeople, orEmpty } from "@/features/rosters"
import { AccessRestricted, apiFailureView, mockGate } from "@/features/shell"
import { ApiError } from "@/lib/api/problem"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { addDays } from "@/lib/shifts"
import { requireMfaOk } from "@/lib/session"

/** The window My roster reads: four weeks back (the calendar's recent past) to thirteen weeks ahead. The API caps a read at 366 days. */
const BACK = 28
const AHEAD = 90

// My roster on the API (Module 1A, FR-RS-23/33/40/41; B8 Task 22): the signed-in person's own published shifts (GET /v1/roster/mine: the person is the session, never a query), availability,
// leave and their own claims and swaps. A caller with a site view also gets the people list (names in the leave queue, colleagues for a swap): the API cut both to their sites.
export default async function Page() {
  const off = mockGate("My roster")
  if (off) return off
  const [session, org] = await Promise.all([requireMfaOk(), getOrg()])
  if (!can(session.role, "roster")) return <AccessRestricted moduleLabel="My roster" />
  const me = session.user.id
  const day = org.today.slice(0, 10)
  const loaded = await loadMyRoster({ from: addDays(day, -BACK), to: addDays(day, AHEAD) }, me).then((mine) => ({ ok: true as const, mine })).catch((e: unknown) => ({ ok: false as const, e }))
  if (!loaded.ok) {
    const v = apiFailureView(loaded.e, "My roster")
    if (v) return v
    if (loaded.e instanceof ApiError && (loaded.e.status === 403 || loaded.e.status === 404)) return <AccessRestricted moduleLabel="My roster" />
    throw loaded.e
  }
  const { mine } = loaded
  const [queue, exchanges, people] = await Promise.all([
    orEmpty(loadLeaveQueue(), { items: [], nextCursor: null }),
    orEmpty(loadExchanges(), { items: [], nextCursor: null }),
    mine.access.level === null ? Promise.resolve(null) : orEmpty(loadRosterPeople(), null),
  ])
  const names = Object.fromEntries((people?.members ?? []).map((m) => [m.id, m.name]))
  return (
    <MyRosterView
      mine={mine} queue={queue.items} names={names} exchanges={exchanges.items} me={me} today={org.today} nowAt={org.nowAt ?? new Date().toISOString()}
      people={people ? people.members.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name })) : null} peopleTruncated={people?.truncated ?? false}
    />
  )
}
