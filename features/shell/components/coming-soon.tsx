import Link from "next/link"

import { Icon } from "@/components/icons"

import type { NavItemData } from "../types"

export function ComingSoon({ item }: { item: NavItemData }) {
  return (
    <>
      <div className="head">
        <div>
          <h1>{item.label}</h1>
          <p>This section is on the way.</p>
        </div>
      </div>
      <section className="card soon">
        <span className="soon-mark">
          <Icon name={item.icon} />
        </span>
        <span className="soon-pill">Coming soon</span>
        <h2>{item.label} is being built</h2>
        {item.description && <p>{item.description}</p>}
        {item.srs && <small className="soon-ref">Planned in {item.srs}</small>}
        <Link href="/" className="btn btn-primary">
          <Icon name="grid" />
          Back to Dashboard
        </Link>
      </section>
    </>
  )
}
