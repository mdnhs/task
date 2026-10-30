import Link from "next/link"

import { Icon } from "@/components/icons"
import { hasModule } from "@/lib/entitlements"
import { can, moduleForHref } from "@/lib/permissions"
import { getSession } from "@/lib/session"

import { getNavigation } from "../api"

// Page body for a route the current role can't open. Pages gate with `can()` from lib/permissions.
// session.role is already narrowed to the tenant's plan (FR-M0-15), so when the role would have access but the plan lacks the module,
// this shows the "Not in your plan" variant with a link to billing instead of the permission message.
// `home`: where the way-out button goes (the platform console sends staff back to its overview).
export async function AccessRestricted({ moduleLabel, home = { href: "/", label: "Back to Dashboard" } }: { moduleLabel: string; home?: { href: string; label: string } }) {
  const [session, nav] = await Promise.all([getSession(), getNavigation()])
  const href = [...nav.menu, ...nav.general].find((n) => n.label === moduleLabel)?.href
  const mod = href ? moduleForHref(href) : null
  const original = session.roles.find((r) => r.id === session.role.id) ?? session.role
  const notInPlan = !!mod && !hasModule(session.entitlements, mod) && can(original, mod)

  if (notInPlan) {
    return (
      <>
        <div className="head">
          <div>
            <h1>Not in your plan</h1>
            <p>{moduleLabel} isn&apos;t part of your current plan.</p>
          </div>
        </div>
        <section className="card soon" data-variant="plan">
          <span className="soon-mark">
            <Icon name="lock" />
          </span>
          <h2>Not in your plan</h2>
          <p>{moduleLabel} isn&apos;t included in the {session.entitlements.planId.replace(/^./, (c) => c.toUpperCase())} plan. See the plan to add it.</p>
          <Link href="/settings/billing" className="btn btn-primary">
            <Icon name="wallet" />
            View plan and upgrade
          </Link>
        </section>
      </>
    )
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Access restricted</h1>
          <p>You don&apos;t have permission to view this page.</p>
        </div>
      </div>
      <section className="card soon">
        <span className="soon-mark">
          <Icon name="lock" />
        </span>
        <h2>Access restricted</h2>
        <p>Your role doesn&apos;t include {moduleLabel}. This attempt has been logged.</p>
        <Link href={home.href} className="btn btn-primary">
          <Icon name="grid" />
          {home.label}
        </Link>
      </section>
    </>
  )
}
