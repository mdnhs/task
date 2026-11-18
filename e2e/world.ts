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
}
