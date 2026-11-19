import { slugOf } from "./ids"
import type { Source } from "./source"

export type Person = {
  /** Stable key = the demo email. */
  email: string
  name: string
  roleKey: string
  active: boolean
  /** The ids this person has in the mock (u1.. in settings/users, p-.. in tasks/people). */
  mockIds: string[]
  teams: string[]
  managerEmail: string | null
}

const SUPERVISOR = /supervisor|team lead/i

/** Every person id the roster files name (shifts, history, requests, claims, leave, availability, workforce, week templates, access). */
export function rosterPersonIds(r: Source["rosters"]): Set<string> {
  const ids = new Set<string>()
  const add = (v: string | null | undefined) => void (v && ids.add(v))
  for (const w of r.weeks) add(w.publishedBy)
  for (const x of r.shifts) add(x.personId)
  for (const x of r.history) add(x.by)
  for (const x of r.requests) { add(x.by); add(x.decidedBy) }
  for (const x of r.claims) { add(x.personId); add(x.decidedBy) }
  for (const x of r.swaps) { add(x.fromPersonId); add(x.toPersonId) }
  for (const x of r.leave) { add(x.personId); add(x.decidedBy) }
  for (const x of r.availability) add(x.personId)
  for (const x of r.workforce) add(x.id)
  for (const t of r.weekTemplates) for (const x of t.shifts) add(x.personId)
  for (const g of r.access.grants) add(g.personId)
  for (const l of r.access.limits) add(l.personId)
  return ids
}

/**
 * The people of the full-dataset tenant: settings/users.json (14 accounts with a role) and tasks/people.json (11 people tasks, shifts and reports
 * point at), matched BY NAME. A person without an account row gets a synthetic `<slug>@<domain>` and the role their title implies.
 */
export function buildPeople(src: Source, domain: string): { people: Person[]; byMock: Map<string, Person>; byName: Map<string, Person> } {
  const people: Person[] = []
  const byMock = new Map<string, Person>()
  const byName = new Map<string, Person>()
  const add = (p: Person) => {
    people.push(p)
    byName.set(p.name, p)
    for (const id of p.mockIds) byMock.set(id, p)
  }
  for (const u of src.users) {
    add({ email: `${u.email.split("@")[0].toLowerCase()}@${domain}`, name: u.name, roleKey: u.role, active: u.status === "active", mockIds: [u.id], teams: u.dept ? [u.dept] : [], managerEmail: null })
  }
  for (const p of src.people) {
    const known = byName.get(p.name)
    if (known) {
      known.mockIds.push(p.id)
      byMock.set(p.id, known)
      continue
    }
    add({ email: `${slugOf(p.name)}@${domain}`, name: p.name, roleKey: SUPERVISOR.test(p.role) ? "supervisor" : "employee", active: true, mockIds: [p.id], teams: p.dept ? [p.dept] : [], managerEmail: null })
  }
  // the people the roster files name that have no account yet (`s-...` ids): the name comes from staff-rosters/staff.json; a name an account already has is that account, a new one is an
  // employee (deactivated when the workforce file says they left), so every roster row points at a real member
  const left = new Set(src.rosters.workforce.filter((w) => w.leftOn).map((w) => w.id))
  for (const id of rosterPersonIds(src.rosters)) {
    if (byMock.has(id)) continue
    const st = src.rosters.staff.find((x) => x.id === id)
    if (!st) continue
    const known = byName.get(st.name)
    if (known) {
      known.mockIds.push(id)
      byMock.set(id, known)
    } else add({ email: `${slugOf(st.name)}@${domain}`, name: st.name, roleKey: "employee", active: !left.has(id), mockIds: [id], teams: st.dept ? [st.dept] : [], managerEmail: null })
  }
  // shifts/members.json: team membership and the reporting line, verbatim
  for (const m of src.members) {
    const p = byMock.get(m.personId)
    if (!p) continue
    p.teams = [...new Set([...p.teams, ...m.teams])]
    p.managerEmail = m.managerId ? (byMock.get(m.managerId)?.email ?? null) : null
  }
  return { people, byMock, byName }
}

/** Every manager-of-manager pair (a manager sees only direct reports, F5): [manager, member] for each ancestor above the direct manager. */
export function indirectPairs(people: Person[]): [manager: string, member: string][] {
  const manager = new Map(people.filter((p) => p.managerEmail).map((p) => [p.email, p.managerEmail as string]))
  const out: [string, string][] = []
  for (const p of people) {
    const seen = new Set<string>([p.email])
    for (let up = manager.get(p.email) && manager.get(manager.get(p.email)!); up && !seen.has(up); up = manager.get(up)) {
      seen.add(up)
      out.push([up, p.email])
    }
  }
  return out
}
