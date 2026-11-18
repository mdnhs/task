// The browser side of shifts (B6 T6.7): every write is ONE call to the API through the BFF. Rules kept here: a pattern edit sends the pattern's CURRENT `version` (D4, a pattern without
// one throws before any request); a team is sent by its id (the screens show its name); a team-scope manager's 403 reads "All-scope managers only" (F5).
import type { ApiClient } from "@/lib/api/client"
import { ApiError, classifyApiError, userMessage } from "@/lib/api/problem"
import type { Weekday } from "@/lib/shifts"
import type { ShiftPatternRow, TeamRef } from "./types"

export type PatternForm = { name: string; team: string; start: string; end: string; days: Weekday[]; timeZone?: string }

const bad = (what: string): never => {
  throw new Error(`shifts: ${what}`)
}

export function makeShiftsClient(api: ApiClient, teams: TeamRef[]) {
  const teamId = (name: string): string => teams.find((t) => t.name === name)?.id ?? bad(`unknown team "${name}"`)
  return {
    async createPattern(f: PatternForm) {
      return api.post("/v1/shifts/patterns", { body: { name: f.name, teamId: teamId(f.team), start: f.start, end: f.end, days: f.days, ...(f.timeZone ? { timeZone: f.timeZone } : {}) } })
    },
    async updatePattern(prev: Pick<ShiftPatternRow, "id" | "version" | "timeZone">, f: PatternForm) {
      if (!Number.isInteger(prev.version) || prev.version < 1) bad("a pattern edit needs the pattern version")
      const zone = f.timeZone ? { timeZone: f.timeZone } : prev.timeZone ? { timeZone: null } : {}
      return api.patch("/v1/shifts/patterns/{id}", { path: { id: prev.id }, body: { version: prev.version, name: f.name, teamId: teamId(f.team), start: f.start, end: f.end, days: f.days, ...zone } })
    },
    /** The pattern is archived (never deleted): no new shifts or assignments, reports and history stay. */
    async archivePattern(p: Pick<ShiftPatternRow, "id">) {
      await api.delete("/v1/shifts/patterns/{id}", { path: { id: p.id } })
    },
    async assign(userId: string, patternId: string, from: string) {
      return api.post("/v1/shifts/assignments", { body: { userId, patternId, from } })
    },
    async endAssignment(id: string, until: string | null) {
      return api.patch("/v1/shifts/assignments/{id}", { path: { id }, body: { until } })
    },
    async deleteAssignment(id: string) {
      await api.delete("/v1/shifts/assignments/{id}", { path: { id } })
    },
    async setTeamReporting(team: string, on: boolean) {
      return api.put("/v1/shifts/reporting/teams/{teamId}", { path: { teamId: teamId(team) }, body: { on } })
    },
    /** `on: null` follows the team default again. */
    async setPersonReporting(userId: string, on: boolean | null) {
      return api.put("/v1/shifts/reporting/people/{userId}", { path: { userId }, body: { on } })
    },
  }
}

export type ShiftsClient = ReturnType<typeof makeShiftsClient>

/** Copy for a refused shift write. A 403 `forbidden` on a write is the team-scope manager (F5): only all-scope managers edit patterns, assignments and reporting. */
export function shiftsMessage(e: unknown): { text: string; ref: string | null } {
  const { kind, code } = classifyApiError(e)
  if (e instanceof ApiError && kind === "forbidden" && code === "forbidden") return { text: "All-scope managers only.", ref: e.requestId || null }
  return userMessage(e)
}
