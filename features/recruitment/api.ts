import { getData } from "@/lib/data"
import { getPeople } from "@/lib/people"
import type { Candidate } from "./types"

export async function getCandidates() {
  const [{ candidates }, people] = await Promise.all([getData<{ candidates: Candidate[] }>("recruitment/candidates.json"), getPeople()])
  return { candidates, owners: people.map((p) => p.name) }
}

/** Contact details are personal data (FR-REC-03): only write-access roles get them, stripped here on the server. */
export const forRole = (candidates: Candidate[], canWrite: boolean): Candidate[] =>
  canWrite ? candidates : candidates.map((c) => ({ ...c, contact: undefined }))
