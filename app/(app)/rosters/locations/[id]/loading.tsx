import { LocationFormSkeleton } from "@/features/rosters"

// Static (K1, I9): loading.tsx gets no params, so it draws the TYPICAL location form (synthetic, two shift types), never the first location's data.
export default function Loading() {
  return <LocationFormSkeleton />
}
