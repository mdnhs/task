import Link from "next/link"

import { Icon } from "@/components/icons"
import { mockEnabled } from "@/lib/mock-registry"

/** First line of every mock page: `const off = mockGate("Orders & Stock"); if (off) return off`. The unavailable state unless the demo flag is on; the page then loads no data. */
export function mockGate(moduleLabel: string, text?: string): React.ReactElement | null {
  return mockEnabled() ? null : <NotAvailableYet moduleLabel={moduleLabel} text={text} />
}

// The page body of a screen that has no backend yet and is shown only on a demo deployment (B6 ruling I16, ENABLE_MOCK_MODULES=1). Used first for the mock Manager Attention queue (T6.7);
// T6.9 adds the registry list and uses it for every mock screen. Same markup as the other full-page states (.head and .card.soon).
export function NotAvailableYet({ moduleLabel, home = { href: "/", label: "Back to Dashboard" }, text }: { moduleLabel: string; home?: { href: string; label: string }; text?: string }) {
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
        <p>{text ?? `${moduleLabel} is coming in a later release. The dashboard shows what needs your attention now.`}</p>
        <Link href={home.href} className="btn btn-primary">
          <Icon name="grid" />
          {home.label}
        </Link>
      </section>
    </>
  )
}
