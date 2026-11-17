"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { Sk } from "@/components/sk"
import { onBillingBlocked } from "@/lib/api/blocked"
import { bannerOf, type BannerInput } from "@/lib/billing-state"

// Shown above every page when the company's billing needs attention (FR-SAAS-08, B6 T6.4): trial running, trial over (grace, with the end date in the
// tenant's zone), payment failed, or read-only (blocked). A write that still answers 402 in this browser flips it to read-only at once and asks the page to
// re-read the session (so every write button follows). It never calls the API itself.
export function BillingBanner(props: Omit<BannerInput, "forceBlocked">) {
  const router = useRouter()
  const [blocked, setBlocked] = React.useState(false)
  React.useEffect(
    () =>
      onBillingBlocked(() => {
        setBlocked(true)
        router.refresh()
      }),
    [router],
  )
  const b = bannerOf({ ...props, forceBlocked: blocked })
  if (!b) return null
  return (
    <div className="sub-banner" data-tone={b.tone === "info" ? undefined : b.tone} role="status">
      <span>{b.text}</span>
      {b.action && <Link href={b.action.href}>{b.action.label}</Link>}
    </div>
  )
}

/** The banner's loading shape: the real `.sub-banner` box with its text as ghost. Used only where a state is known to show one; a healthy company has no banner, so none renders by default. */
export function BillingBannerSkeleton({ text = "Trial ends Wed 25 Nov (Local time)", action = "Choose a plan" }: { text?: string; action?: string }) {
  return (
    <div className="sub-banner" aria-hidden="true">
      <span className="sk-ghost">{text}</span>
      <Sk w={action.length * 8} h={13} lh={19} style={{ marginLeft: "auto" }} />
    </div>
  )
}
