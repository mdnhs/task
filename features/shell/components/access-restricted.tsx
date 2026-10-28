import Link from "next/link"

import { Icon } from "@/components/icons"

// Page body for a route the current role can't open. Pages gate with `can()` from lib/permissions.
export function AccessRestricted({ moduleLabel }: { moduleLabel: string }) {
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
        <Link href="/" className="btn btn-primary">
          <Icon name="grid" />
          Back to Dashboard
        </Link>
      </section>
    </>
  )
}
