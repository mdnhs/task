import { Icon } from "@/components/icon"

/** The API cut a people list at its cap (`membersTruncated`: 500 people). Said wherever people are picked from, so nobody thinks the list is the whole team. */
export const MEMBERS_CAP = 500

export function CutHint({ cut }: { cut: boolean }) {
  if (!cut) return null
  return (
    <p className="ros-cut" role="note">
      <Icon name="info" size={24} />
      List is cut at {MEMBERS_CAP}
    </p>
  )
}
