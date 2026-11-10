import { MyRosterSkeleton } from "@/features/rosters"
import { PageSkeleton } from "@/features/shell"
import { myRosterGate } from "./gate"

export default async function Loading() {
  const g = await myRosterGate()
  if (!g) return <PageSkeleton />
  return <MyRosterSkeleton {...g} />
}
