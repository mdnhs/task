import Link from "next/link"
import { Icon } from "@/components/icon"

/** The console's "back to the list" link: the chevron-left icon before a short label. The icon is decorative; the visible label names the target. */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="pf-back">
      <Icon name="chevron-left" size={16} strokeWidth={2} className="pf-back-ico" />
      <span className="pf-back-lbl">{children}</span>
    </Link>
  )
}
