// A stable avatar colour for a user id. Pure (no file access), so client components may import it.
import type { Person } from "./types"

const AVATARS = ["av1", "av2", "av3", "av4", "av5", "av6"] as const

/** A stable colour class for a user id (FNV-1a of the id): the same person always gets the same avatar, on every screen and every load. */
export function avatarFor(id: string): Person["avatar"] {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193)
  return AVATARS[(h >>> 0) % AVATARS.length]!
}
