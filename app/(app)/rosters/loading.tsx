import { RostersSkeleton } from "@/features/rosters"

// Static (K1, ruling I9): no API, no session lookup. The TYPICAL week of one location with the write controls; a role with less access, or another roster, differs by a small layout change when
// the real page replaces it.
export default function Loading() {
  return <RostersSkeleton />
}
