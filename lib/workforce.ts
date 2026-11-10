import { getData } from "./data"
import { getPeople } from "./people"
import type { Person } from "./types"

// One person id across the app (D2). The directory (`tasks/people.json`, `p-*`) is canonical: a staff row with `personId` is that
// directory person, and the rest keep their `s-*` id. Roster-only facts (home location, qualifications, leaving date) come from
// `rosters/workforce.json`, keyed by the merged id.

export type Qualification = { type: string; expires: string | null }
export type WorkforceMember = { id: string; name: string; role: string; dept: string; homeLocationId: string | null; qualifications: Qualification[]; leftOn: string | null }
export type StaffRow = { id: string; personId?: string; name: string; role: string; dept: string }
export type WorkforceExtra = { id: string; homeLocationId?: string | null; qualifications?: Qualification[]; leftOn?: string | null }

export function mergeWorkforce(people: Person[], staff: StaffRow[], extras: WorkforceExtra[]): WorkforceMember[] {
  const extra = new Map(extras.map((e) => [e.id, e]))
  const make = (id: string, name: string, role: string, dept: string): WorkforceMember => {
    const e = extra.get(id)
    return { id, name, role, dept, homeLocationId: e?.homeLocationId ?? null, qualifications: e?.qualifications ?? [], leftOn: e?.leftOn ?? null }
  }
  const out = new Map<string, WorkforceMember>()
  for (const p of people) out.set(p.id, make(p.id, p.name, p.role, p.dept))
  for (const s of staff) {
    const id = s.personId ?? s.id
    if (!out.has(id)) out.set(id, make(id, s.name, s.role, s.dept))
  }
  return [...out.values()]
}

/** Server only. */
export async function getWorkforce(): Promise<WorkforceMember[]> {
  const [people, { staff }, { extras }] = await Promise.all([
    getPeople(),
    getData<{ staff: StaffRow[] }>("staff-rosters/staff.json"),
    getData<{ extras: WorkforceExtra[] }>("rosters/workforce.json"),
  ])
  return mergeWorkforce(people, staff, extras)
}
