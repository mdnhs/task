import { OnboardingWizard, getOnboardingData } from "@/features/auth"

export default async function Page() {
  const { defaults, roles } = await getOnboardingData()
  return <OnboardingWizard defaults={defaults} roles={roles} />
}
