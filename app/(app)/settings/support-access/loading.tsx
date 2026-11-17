import { SupportAccessSkeleton } from "@/features/settings"

// Static: never reads the session or the API.
export default function Loading() {
  return <SupportAccessSkeleton />
}
