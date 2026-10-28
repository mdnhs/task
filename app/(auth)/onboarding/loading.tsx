import { OnboardingSkeleton, getOnboardingData } from "@/features/auth"

// Async so the skeleton shows the seeded department rows.
export default async function Loading() {
  const { defaults } = await getOnboardingData()
  return <OnboardingSkeleton departments={defaults.departments.length} />
}
