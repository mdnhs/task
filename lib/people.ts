import { getData } from "./data"
import { initialsOf } from "./branding"
import type { ApiClient } from "./api/client"
import type { Person } from "./types"

// ---- The real directory: GET /v1/people (B6 T6.4, ruling I11) ----

const AVATARS = ["av1", "av2", "av3", "av4", "av5", "av6"] as const
const FORMER = "Former member"

/** A stable colour class for a user id (FNV-1a of the id): the same person always gets the same avatar, on every screen and every load. */
export function avatarFor(id: string): Person["avatar"] {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193)
  return AVATARS[(h >>> 0) % AVATARS.length]!
}

type PersonDto = { userId: string; name: string; email: string; roleKey: string; managerId: string | null }

/** An erased user keeps a row only as an anonymised shell: the API writes the name "Erased user" and an erased+<uuid>@invalid address. They show as "Former member". */
const isErased = (p: PersonDto) => p.name.trim() === "Erased user" || /^erased\+.+@invalid$/i.test(p.email)
const humanise = (key: string) => {
  const s = key.replace(/[_-]+/g, " ").trim()
  return s ? s[0]!.toUpperCase() + s.slice(1) : key
}

/**
 * One /v1/people row as the FE Person: `id` is the USER id, `role` the role's label (a key the label table does not know reads as a readable form of the key),
 * `dept` the department team the person belongs to (empty when none), and a person with no name shows the local part of their email.
 */
export function toPerson(p: PersonDto, ctx: { roleLabel: (key: string) => string | undefined; departmentOf: (userId: string) => string }): Person {
  const name = isErased(p) ? FORMER : p.name.trim() || p.email.split("@")[0]!.trim() || FORMER
  return { id: p.userId, name, role: ctx.roleLabel(p.roleKey) ?? humanise(p.roleKey), initials: initialsOf(name), avatar: avatarFor(p.userId), dept: ctx.departmentOf(p.userId) }
}

/**
 * Reads /v1/people (module M1, reports:read) and the department teams (any member) and maps them. Both are scoped by the API: the caller sees the people in their
 * report scope, and the FE does not filter further (ruling I14). `roleLabel` comes from the static role table (a plain member cannot read /v1/roles).
 */
export async function loadPeople(api: Pick<ApiClient, "get">, roleLabel: (key: string) => string | undefined): Promise<Person[]> {
  const [rows, teams] = await Promise.all([api.get("/v1/people"), api.get("/v1/teams", { query: { kind: "department" } })])
  const dept = new Map<string, string>()
  for (const t of teams) for (const id of t.memberIds) if (!dept.has(id)) dept.set(id, t.name)
  return rows.map((r) => toPerson(r, { roleLabel, departmentOf: (id) => dept.get(id) ?? "" }))
}

/** The caller's directory. Server only (it reads the session cookie through apiServer). */
export async function getPeople(): Promise<Person[]> {
  const { apiServer } = await import("./api/server")
  const { roles } = await getData<{ roles: { id: string; label: string; platform?: boolean }[] }>("shell/roles.json")
  return loadPeople(await apiServer(), (key) => roles.find((r) => r.id === key && !r.platform)?.label)
}

// ---- MOCK: no backend until T6.5 to T6.8 ----

// "me" for any staff-home role (mock): Daniel Okafor, same person as public/data/dashboard/staff/*.json.
export const ME_ID = "p-daniel"

/** MOCK: the seed directory (tasks/people.json, ids `p-*`) that pages still running on mock records use. A switched page uses getPeople(). */
export async function getMockPeople(): Promise<Person[]> {
  const { people } = await getData<{ people: Person[] }>("tasks/people.json")
  return people
}
