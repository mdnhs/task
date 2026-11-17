import { SignInForm, getProviders } from "@/features/auth"
import { safeNext } from "@/lib/safe-next"

// Never redirects (a dead session cookie lands here via /api/session/expired, which already cleared it): no loop. `next` is checked here and again in afterSignIn.
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string | string[]; reason?: string | string[] }> }) {
  const sp = await searchParams
  const next = safeNext(Array.isArray(sp.next) ? sp.next[0] : sp.next)
  return <SignInForm providers={await getProviders()} next={next} expired={sp.reason === "expired"} />
}
