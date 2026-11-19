"use client"

import { useRouter } from "next/navigation"

import { EmptyState } from "@/components/empty-state"
import { Icon } from "@/components/icon"

// The data could not be read (a wrong or failed response): say so and offer one retry. No detail is shown.
export function WhatsAppError({ title = "Could not load WhatsApp" }: { title?: string }) {
  const router = useRouter()
  return (
    <section className="card set-card" role="alert">
      <EmptyState icon="warning" title={title} text="Something went wrong on our side. Try again in a moment." action={<button type="button" className="btn btn-primary" onClick={() => router.refresh()}>Try again</button>} />
    </section>
  )
}

/** The same, as a card of the Integrations grid. */
export function WhatsAppCardError() {
  const router = useRouter()
  return (
    <li className="set-int wa-int" role="alert">
      <div className="set-int-top">
        <span className="set-int-ico" aria-hidden="true"><Icon name="bubble-chat" /></span>
        <div className="set-int-name">
          <h3>WhatsApp</h3>
          <span className="st bad">Unavailable</span>
        </div>
      </div>
      <p className="set-int-desc">Could not load WhatsApp. Try again in a moment.</p>
      <div className="set-int-foot"><button type="button" className="btn btn-outline" onClick={() => router.refresh()}>Try again</button></div>
    </li>
  )
}
