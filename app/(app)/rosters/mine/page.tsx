import { MyRosterView } from "@/features/rosters"
import { AccessRestricted, getUser } from "@/features/shell"
import { getSession } from "@/lib/session"
import { myRosterGate } from "./gate"

// My roster (Module 1A, FR-RS-23/33/40/41): the signed-in person's own shifts, availability and leave.
export default async function Page() {
  const [session, user] = await Promise.all([getSession(), getUser()])
  const g = await myRosterGate(session, user)
  if (!g) return <AccessRestricted moduleLabel="My roster" />
  return <MyRosterView {...g} />
}
