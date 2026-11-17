"use client"

import { useEffect } from "react"

import { Icon } from "@/components/icons"
import { errorView } from "@/lib/error-view"

// The route-segment error page (Next 16 error.js). It sits inside the root layout, so it has the OpsDesk theme; it catches a failed page AND a failed
// (app) layout (an API 5xx or network error while loading getSession or getOrg). Static markup, no skeleton. Only mapped copy and a reference are shown:
// the thrown message and stack never reach the page (errorView). Retry re-fetches the server render (`retry`, Next 16.3); `reset` re-renders without a fetch and is the fallback.
export default function ErrorPage({ error, retry, reset }: { error: unknown; retry?: () => void; reset?: () => void }) {
  const { text, ref } = errorView(error)
  useEffect(() => {
    // Operators match this digest to the server log; the console line carries no message.
    if (ref) console.error(`render error ref ${ref}`)
  }, [ref])
  return (
    <main className="err-page" role="alert">
      <section className="card err-card">
        <span className="err-mark" aria-hidden="true"><Icon name="flag" /></span>
        <h1>Something went wrong</h1>
        <p>{text}</p>
        <button type="button" className="btn btn-primary" onClick={() => (retry ?? reset)?.()}>Try again</button>
        {ref && <small className="err-ref">Ref {ref}</small>}
      </section>
    </main>
  )
}
