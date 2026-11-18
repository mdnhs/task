import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"

/** The console's "back to the list" link: the ArrowLeft01 chevron (Hugeicons) before a short label. The icon is decorative; the visible label names the target. */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="pf-back">
      <HugeiconsIcon icon={ArrowLeft01Icon} size={16} strokeWidth={2} aria-hidden="true" className="pf-back-ico" />
      <span className="pf-back-lbl">{children}</span>
    </Link>
  )
}
