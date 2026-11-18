import type { Person } from "./types"

/** A person the caller cannot see (a co-assignee outside their scope): a neutral "Member" with no initials, never the raw user id (found in the T6.9 browser walk). */
export const personOf = (byId: ReadonlyMap<string, Person>, id: string): Person => byId.get(id) ?? { id, name: "Member", initials: "?", avatar: "av1", role: "", dept: "" }
