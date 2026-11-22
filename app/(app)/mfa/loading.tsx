import { MfaSkeleton } from "@/features/account"

// Static: the set-up card's first step. The page redirects home when nothing is outstanding, so this only shows on the way to the card.
export default function Loading() {
  return <MfaSkeleton />
}
