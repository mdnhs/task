import { MyRosterSkeleton } from "@/features/rosters"
import { PageSkeleton } from "@/features/shell"
import { myRosterGate } from "./gate"
import { getSkeletonSession, getSkeletonUser } from "@/lib/skeleton-session"

export default async function Loading() {
  const g = await myRosterGate(await getSkeletonSession(), await getSkeletonUser())
  if (!g) return <PageSkeleton />
  return <MyRosterSkeleton {...g} />
}
