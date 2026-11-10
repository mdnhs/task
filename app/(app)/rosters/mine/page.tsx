import { MyRosterView } from "@/features/rosters"
import { AccessRestricted } from "@/features/shell"
import { myRosterGate } from "./gate"

// My roster (Module 1A, FR-RS-23/33/40/41): the signed-in person's own shifts, availability and leave.
export default async function Page() {
  const g = await myRosterGate()
  if (!g) return <AccessRestricted moduleLabel="My roster" />
  return <MyRosterView {...g} />
}
