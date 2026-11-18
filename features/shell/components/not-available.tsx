import Link from "next/link"

import { Icon } from "@/components/icons"

// The page body of a screen that has no backend yet and is shown only on a demo deployment (B6 ruling I16, ENABLE_MOCK_MODULES=1). Used first for the mock Manager Attention queue (T6.7);
// T6.9 adds the registry list and uses it for every mock screen. Same markup as the other full-page states (.head and .card.soon).
export function NotAvailableYet({ moduleLabel }: { moduleLabel: string }) {
  return (
    <>
      <div className="head">
        <div>
          <h1>{moduleLabel}</h1>
          <p>Not available yet.</p>
        </div>
      </div>
      <section className="card soon">
        <span className="soon-mark">
          <Icon name="lock" />
        </span>
        <h2>Not available yet</h2>
        <p>{moduleLabel} is coming in a later release. The dashboard shows what needs your attention now.</p>
        <Link href="/" className="btn btn-primary">
          <Icon name="grid" />
          Back to Dashboard
        </Link>
      </section>
    </>
  )
}
