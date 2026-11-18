import { MockPageSkeleton } from "@/features/platform"

// Static (B6 K1): an unbacked page (shown only with ENABLE_MOCK_MODULES=1) cannot know in a loading file whether it will show data or the unavailable state, so this is a plain page shape.
export default function Loading() {
  return <MockPageSkeleton />
}
