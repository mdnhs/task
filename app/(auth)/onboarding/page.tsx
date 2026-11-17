import { redirect } from "next/navigation"

import { OnboardingWizard, getOnboardingData } from "@/features/auth"
import { getIdentity } from "@/lib/session"

// Needs a signed-in person (real check; proxy.ts only looks for the cookie) who has no company yet. Anyone who already belongs to one goes home.
export default async function Page() {
  const { hasTenant } = await getIdentity()
  if (hasTenant) redirect("/")
  const { defaults, roles } = await getOnboardingData()
  return <OnboardingWizard defaults={defaults} roles={roles} />
}
