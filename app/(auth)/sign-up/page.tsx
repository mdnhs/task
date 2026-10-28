import { SignUpWizard, getSignUpData } from "@/features/auth"

export default async function Page() {
  const { defaults, plans } = await getSignUpData()
  return <SignUpWizard defaults={defaults} plans={plans} />
}
