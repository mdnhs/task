import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { rosterStats } from "./stats"

const read = (f: string) => JSON.parse(readFileSync(path.join(process.cwd(), "public/data", f), "utf-8"))

describe("rosterStats", () => {
  it("matches dashboard/coverage.json", () => {
    const [uncovered, gaps, callouts] = read("dashboard/coverage.json").coverage
    const s = rosterStats(read("staff-rosters/incidents.json").incidents, read("staff-rosters/roster-gaps.json").gaps, read("shell/org.json").today)
    expect(s.uncoveredTomorrow).toBe(uncovered.count)
    expect(s.gapsNextWeek).toBe(gaps.count)
    expect(s.calloutsCoveredToday).toBe(callouts.count)
  })
})
