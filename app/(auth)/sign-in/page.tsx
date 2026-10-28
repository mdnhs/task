import { SignInForm, getSignInRoles } from "@/features/auth"

export default async function Page() {
  return <SignInForm roles={await getSignInRoles()} />
}
