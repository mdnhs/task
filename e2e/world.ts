// The shared fixture world every spec starts from, built once in globalSetup through the real API (as the all-scope manager) on top of the seeded demo tenant.
// Why it exists: the seed anchors dates to "today" but no shift has started or is running at every hour of the day, and a report only exists once its shift has
// started. So the world adds one pattern that spans the whole local day ("E2E all day", 00:00-23:59, every weekday) and gives it to five members.
import { apiAs, dublinToday } from "./fixtures"

export const PATTERN = "E2E all day"
/** The five members of the pattern. CR-01 turns reporting on for the first three (the seed leaves each at "off" here). */
export const PATTERN_MEMBERS = ["M. Haddad", "J. Silva", "A. Kowalski", "Ismail Rahman", "Leo Fernandez"] as const
export const REPORTING_ON = PATTERN_MEMBERS.slice(0, 3)

export const TASKS = {
  kowalskiA: "E2E patrol check A",
  kowalskiB: "E2E patrol check B",
  kowalskiLater: "E2E later task (tomorrow)",
  haddad: "E2E gate check (Haddad)",
} as const

export async function buildWorld(): Promise<void> {
  const ops = await apiAs("ops")
  const today = dublinToday()
  const tomorrow = dublinToday(1)
  const people: { userId: string; name: string }[] = await ops.get("/v1/people?limit=100")
  const id = (name: string) => {
    const p = people.find((x) => x.name === name)
    if (!p) throw new Error(`world: no person ${name}`)
    return p.userId
  }
  const teams: { id: string; name: string }[] = await ops.get("/v1/teams")
  const security = teams.find((t) => t.name === "Security")!.id
  const pattern = await ops.send("POST", "/v1/shifts/patterns", { name: PATTERN, teamId: security, start: "00:00", end: "23:59", days: [0, 1, 2, 3, 4, 5, 6] })
  for (const name of PATTERN_MEMBERS) {
    await ops.send("POST", "/v1/shifts/assignments", { userId: id(name), patternId: pattern.id, from: today })
    await ops.send("PUT", `/v1/shifts/reporting/people/${id(name)}`, { on: false })
  }
  const task = (title: string, who: string, start: string, due: string) =>
    ops.send("POST", "/v1/tasks", { title, start, due, primary: id(who), teamId: security })
  await task(TASKS.kowalskiA, "A. Kowalski", `${today}T08:00:00`, `${today}T10:00:00`)
  await task(TASKS.kowalskiB, "A. Kowalski", `${today}T08:00:00`, `${today}T15:00:00`)
  await task(TASKS.kowalskiLater, "A. Kowalski", `${tomorrow}T08:00:00`, `${tomorrow}T10:00:00`)
  await task(TASKS.haddad, "M. Haddad", `${today}T08:00:00`, `${today}T11:00:00`)
  await ops.ctx.dispose()
  await buildRosterWorld()
}

// ------------------------------------------------------------------ rosters (B8 Task 25: CR-07..09, AC-RS-04..06 and the flows the demo seed cannot show)
// Two locations of their own, far from the seed's (the seed's roster weeks sit around today; these start eight weeks out, so no seeded shift is near them):
// QUAYSIDE is supervised by Grace Mensah (a supervisor-level role with no seeded grant: after this she sees Quayside and nothing else), HARBOUR is a site she must never
// see. Three staff are homed at Quayside (so the supervisor's people list has them). Every week a spec acts on is its own, built here through the real API.
export const ROSTER = {
  quayside: "Quayside Depot",
  harbour: "Harbour Gate",
  supervisor: "supervisor2" as const, // Grace Mensah
  staff: { tomasz: "Tomasz Wójcik", kone: "Amara Kone", owen: "Owen Price" },
  early: { name: "Early", start: "08:00", end: "16:00", role: "Cleaner" },
  night: { name: "Night", start: "22:00", end: "06:00", role: "Security officer" },
  /** The clock-change week (Europe/Dublin): the night of Sat 24 to Sun 25 Oct 2026 is 9 real hours (the clocks go back at 02:00). */
  dstWeek: "2026-10-19",
  dstNight: "2026-10-24",
} as const

const iso = (d: Date) => d.toISOString().slice(0, 10)
export const addDaysIso = (day: string, n: number): string => iso(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000))
const mondayOf = (day: string): string => addDaysIso(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7))

/** The Monday of each world week (W0 = eight weeks after this week's Monday). The keys say which spec owns the week. */
export function rosterWeeks(today = dublinToday()) {
  const w = (n: number) => addDaysIso(mondayOf(today), 56 + n * 7)
  return {
    cr07: w(0), // published by the office: seven days, people with times, counts against targets, a short day and an over day
    cr08: w(1), // draft: the supervisor sets an individual start time, then publishes; both people see their own time in My roster
    rest: w(2), // draft: AC-RS-04, a night then an afternoon shift 8 hours later for Tomasz
    lock: w(3), // draft: AC-RS-05, the supervisor publishes, then only the office edits (with a reason)
    repeat: w(4), // published: AC-RS-06, Repeat into repeatNext, where Amara Kone has approved leave on the Wednesday
    repeatNext: w(5), // no week yet
    blocked: w(6), // draft with a BLOCK (Amara Kone on approved leave on the Thursday): the supervisor cannot publish, the office publishes over it with a reason
    approve: w(7), // published; a change request (Tomasz -> Amara Kone, who has approved leave that day) that the office approves over the block
    history: w(8), // draft with 25 single adds: more than one history page (20)
  }
}

export async function buildRosterWorld(): Promise<void> {
  const ops = await apiAs("ops")
  const kone = await apiAs("kone")
  const grace = await apiAs(ROSTER.supervisor)
  try {
    const people: { userId: string; name: string; email?: string }[] = await ops.get("/v1/people?limit=100")
    const id = (name: string) => {
      const p = people.find((x) => x.name === name)
      if (!p) throw new Error(`roster world: no person ${name}`)
      return p.userId
    }
    const T = id(ROSTER.staff.tomasz), K = id(ROSTER.staff.kone), C = id(ROSTER.staff.owen), G = id("Grace Mensah")
    const loc = async (name: string) => (await ops.send("POST", "/v1/locations", { name, address: `${name}, Dublin`, timeZone: "Europe/Dublin" })).id as string
    const A = await loc(ROSTER.quayside)
    const B = await loc(ROSTER.harbour)
    await ops.send("PUT", `/v1/locations/${A}/supervisors`, { userIds: [G] })
    for (const u of [T, K, C]) await ops.send("PUT", `/v1/members/${u}/home-location`, { locationId: A })
    const type = async (l: string, t: { name: string; start: string; end: string; role: string }) => (await ops.send("POST", `/v1/locations/${l}/shift-types`, { ...t, unpaidBreakMin: 30 })).id as string
    const early = await type(A, ROSTER.early)
    const night = await type(A, ROSTER.night)
    await ops.send("PUT", `/v1/shift-types/${early}/targets`, { targets: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, count: 2 })) })
    const earlyB = await type(B, ROSTER.early)

    const W = rosterWeeks()
    const week = async (monday: string, l = A) => (await ops.send("POST", "/v1/roster/weeks", { locationId: l, weekStart: monday })).id as string
    const add = async (weekId: string, date: string, userIds: (string | null)[], shiftTypeId = early, times: { start?: string; end?: string } = {}) =>
      ops.send("POST", `/v1/roster/weeks/${weekId}/shifts`, { shifts: [{ date, userIds, shiftTypeId, ...times }] })
    const publish = async (weekId: string) => {
      const w: { weeks: { id: string; version: number }[] } = await ops.get(`/v1/roster/weeks/${weekId}`)
      await ops.send("POST", `/v1/roster/weeks/${weekId}/publish`, { version: w.weeks.find((x) => x.id === weekId)!.version })
    }
    const leave = async (day: string) => {
      const l = await kone.send("POST", "/v1/leave", { from: day, to: day, kind: "annual", note: "E2E world" })
      await ops.send("POST", `/v1/leave/${l.id}/decide`, { decision: "approve" })
    }
    const d = (monday: string, n: number) => addDaysIso(monday, n)

    // CR-07 / AC-RS-01: Mon 2 of 2 (two people, two start times), Tue 1 of 2 (short), Wed 3 of 2 (over), Thu and Fri 2 of 2.
    const w0 = await week(W.cr07)
    await add(w0, d(W.cr07, 0), [T])
    await add(w0, d(W.cr07, 0), [K], early, { start: "09:30", end: "17:30" })
    await add(w0, d(W.cr07, 1), [C])
    await add(w0, d(W.cr07, 2), [T, K, C])
    await add(w0, d(W.cr07, 3), [T, C])
    await add(w0, d(W.cr07, 4), [K, C])
    await publish(w0)

    // CR-08: two people on Monday's Early shift, both at the type's 08:00 (the spec gives Amara Kone her own start).
    const w1 = await week(W.cr08)
    await add(w1, d(W.cr08, 0), [T, K])

    // AC-RS-04: Tomasz on Monday's night (22:00 to Tue 06:00), then Tuesday 14:00-22:00: 8 hours of rest.
    const w2 = await week(W.rest)
    await add(w2, d(W.rest, 0), [T], night)
    await add(w2, d(W.rest, 1), [T], early, { start: "14:00", end: "22:00" })

    // AC-RS-05: a clean draft the supervisor publishes.
    const w3 = await week(W.lock)
    await add(w3, d(W.lock, 1), [T])
    await add(w3, d(W.lock, 2), [C])

    // AC-RS-06: a published week; Amara Kone works its Wednesday and is on approved leave the Wednesday after.
    const w4 = await week(W.repeat)
    await add(w4, d(W.repeat, 0), [T])
    await add(w4, d(W.repeat, 2), [K])
    await publish(w4)
    await leave(d(W.repeatNext, 2))

    // Blocked publish: Amara Kone rostered on Thursday, THEN her leave for that day is approved: the draft now breaks a block rule (approved_leave).
    const w6 = await week(W.blocked)
    await add(w6, d(W.blocked, 3), [K])
    await add(w6, d(W.blocked, 4), [C])
    await leave(d(W.blocked, 3))

    // Approve over a block: Tomasz on Tuesday (published); Amara Kone is on approved leave that Tuesday; the supervisor asks to give the shift to her.
    const w7 = await week(W.approve)
    const s7 = (await add(w7, d(W.approve, 1), [T])).shifts[0]
    await publish(w7)
    await leave(d(W.approve, 1))
    await grace.send("POST", `/v1/roster/shifts/${s7.id}/change-requests`, { patch: { userId: K }, reason: "Swap agreed on the floor" })

    // History Load more: 25 separate adds (open shifts) = 25 history lines plus "Started the week".
    const w8 = await week(W.history)
    for (let i = 0; i < 25; i++) await add(w8, d(W.history, i % 7), [null], early, { start: `${String(6 + (i % 10)).padStart(2, "0")}:00`, end: `${String(12 + (i % 10)).padStart(2, "0")}:00` })

    // Harbour Gate: a week of its own (an open shift) that only office roles may ever see.
    const wb = await week(W.cr07, B)
    await add(wb, d(W.cr07, 0), [null], earlyB)

    // The clock-change week: Tomasz on the night of Sat 24 Oct 2026 (22:00 to 06:00 across the change), published.
    const wd = await week(ROSTER.dstWeek)
    await add(wd, ROSTER.dstNight, [T], night)
    await publish(wd)
  } finally {
    for (const c of [ops, kone, grace]) await c.ctx.dispose()
  }
}

/** The ids of the world's roster places (looked up again by name: the ids are new on every run). */
export async function rosterIds(): Promise<{ quayside: string; harbour: string }> {
  const ops = await apiAs("ops")
  try {
    const { items }: { items: { id: string; name: string }[] } = await ops.get("/v1/locations")
    const by = (n: string) => items.find((l) => l.name === n)!.id
    return { quayside: by(ROSTER.quayside), harbour: by(ROSTER.harbour) }
  } finally {
    await ops.ctx.dispose()
  }
}
