// Server side of shifts (B6 T6.7): `GET /v1/shifts` is the caller's own cut (a staff-home caller gets only their own rows, a team-scope manager the same bundle as everyone with write access
// limited by the API); nothing here re-scopes it (F5, I14). The week grid is the API's occurrences (`GET /v1/shifts/occurrences`, from the stored instants), never recomputed from patterns.
import type { ApiClient } from "@/lib/api/client"
import { apiServer } from "@/lib/api/server"
import { getPeople } from "@/lib/people"
import type { Session } from "@/lib/session"
import { addDays, weekStart } from "@/lib/shifts"
import type { Person } from "@/lib/types"
import { toOccurrences, toShiftState } from "./adapters"
import type { ShiftScope, ShiftsData, TeamRef } from "./types"

type Reader = Pick<ApiClient, "get">

/** The occurrences of the week starting `start` (a Monday), mapped with the state's patterns. */
export async function loadWeek(api: Reader, state: Parameters<typeof toOccurrences>[1], tz: string, start: string, userId?: string) {
  const dto = await api.get("/v1/shifts/occurrences", { query: { from: start, to: addDays(start, 6), ...(userId ? { userId } : {}) } })
  return toOccurrences(dto, state, tz)
}

export async function loadShifts(api: Reader, o: { tz: string; today: string; scope: ShiftScope; meId: string; people: Person[] }): Promise<ShiftsData> {
  const [dto, teams] = await Promise.all([api.get("/v1/shifts"), api.get("/v1/teams")])
  const refs: TeamRef[] = teams.map((t) => ({ id: t.id, name: t.name }))
  const state = toShiftState(dto, refs)
  const start = weekStart(o.today.slice(0, 10))
  const occurrences = await loadWeek(api, state, o.tz, start)
  // what the API sent is what is shown: for "own" the cut already holds only the caller's rows; the only other person is the caller's primary manager (for the "Manager" line)
  const teamNames = o.scope === "own" ? [...new Set(state.members.flatMap((m) => m.teams))].filter(Boolean) : refs.map((t) => t.name)
  return { state, people: o.people, teams: teamNames, teamRefs: refs, scope: o.scope, meId: o.meId, weekStart: start, occurrences }
}

export async function shiftsScreenData(session: Pick<Session, "user">): Promise<{ api: ApiClient; people: Person[] }> {
  void session
  const [api, people] = await Promise.all([apiServer(), getPeople()])
  return { api, people }
}
