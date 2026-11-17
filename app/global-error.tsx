"use client"

import { errorView } from "@/lib/error-view"

// The last-resort page (Next 16 global-error): it REPLACES the root layout, so it has no app CSS or theme provider. It brings its own tiny inline style that follows the OS
// colour scheme, in the OpsDesk palette. Static markup, no skeleton, no thrown message or stack (errorView), a Retry button.
const CSS = `
:root{--bg:#e8ebe6;--card:#fcfdfa;--ink:#1f2a24;--ink-2:#56625b;--brand:#1a8a3a;--on:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#111614;--card:#1f2722;--ink:#e2e8e3;--ink-2:#a9b5ad;--brand:#5fbb87;--on:#111614}}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--ink);font-family:system-ui,sans-serif}
.card{max-width:420px;width:100%;box-sizing:border-box;padding:28px;border-radius:20px;background:var(--card);text-align:center}
h1{margin:0 0 8px;font-size:20px}p{margin:0 0 18px;color:var(--ink-2);font-size:14px;line-height:21px}
button{height:48px;padding:0 22px;border:0;border-radius:999px;background:var(--brand);color:var(--on);font-size:14px;font-weight:600;cursor:pointer}
small{display:block;margin-top:14px;color:var(--ink-2);font-size:12px}
`

export default function GlobalError({ error, retry, reset }: { error: unknown; retry?: () => void; reset?: () => void }) {
  const { text, ref } = errorView(error)
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Something went wrong</title>
        <style>{CSS}</style>
      </head>
      <body>
        <main className="card" role="alert">
          <h1>Something went wrong</h1>
          <p>{text}</p>
          <button type="button" onClick={() => (retry ?? reset)?.()}>Try again</button>
          {ref && <small>Ref {ref}</small>}
        </main>
      </body>
    </html>
  )
}
