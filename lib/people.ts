import { getData } from "./data"
import type { Person } from "./types"

// "me" for any staff-home role (mock): Daniel Okafor, same person as public/data/dashboard/staff/*.json.
export const ME_ID = "p-daniel"

export async function getPeople(): Promise<Person[]> {
  const { people } = await getData<{ people: Person[] }>("tasks/people.json")
  return people
}
