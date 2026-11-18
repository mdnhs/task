import { Live360Skeleton } from "@/features/platform"

// Entering a tenant from elsewhere: the typical header, tabs and overview card, masked. Static (B6 K1). Switching tabs inside the 360 uses (tabs)/[tab]/loading.tsx.
export default function Loading() {
  return <Live360Skeleton />
}
