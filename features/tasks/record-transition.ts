// Row → detail continuity for /tasks → /tasks/[ref]: the clicked row title morphs into the detail page heading with the
// View Transitions API. Feature-detected; without support (or with reduced motion) it is a plain client navigation.
// The view-transition-name is set only on the two elements involved, only for this one transition, so other transitions
// (the theme toggle's circular reveal) never capture table rows.

/** Longest the old frame is held while the detail page loads. */
const HOLD_MS = 600

type StartVT = (update: () => Promise<void>) => { finished: Promise<void> }

/** A CSS <custom-ident> per record: "TSK-1042" → "od-rec-TSK-1042". Anything else than [A-Za-z0-9_-] becomes "_". */
export function recordVtName(ref: string): string {
  return `od-rec-${ref.replace(/[^A-Za-z0-9_-]/g, "_")}`
}

/** Waits (MutationObserver; rAF is paused while a view transition holds rendering) until `find` returns an element, or the timeout.
 *  The old frame stays frozen meanwhile, so the timeout is short: past it the transition just crossfades to whatever is there (the skeleton). */
function waitFor(find: () => HTMLElement | null, timeout: number): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const hit = find()
    if (hit) return resolve(hit)
    const done = (el: HTMLElement | null) => {
      obs.disconnect()
      window.clearTimeout(t)
      resolve(el)
    }
    // The route's loading.tsx skeleton usually shows first; keep waiting (briefly) for the real heading behind it.
    const obs = new MutationObserver(() => {
      const el = find()
      if (el) done(el)
    })
    obs.observe(document.body, { childList: true, subtree: true })
    const t = window.setTimeout(() => done(null), timeout)
  })
}

/** Returns false when the caller should let the link navigate normally. */
export function morphToRecord(opts: { source: HTMLElement; title: string; ref: string; href: string; push(href: string): void }): boolean {
  const start = (document as Document & { startViewTransition?: StartVT }).startViewTransition?.bind(document)
  if (!start || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false
  const name = recordVtName(opts.ref)
  const root = document.documentElement
  let target: HTMLElement | null = null
  opts.source.style.viewTransitionName = name
  root.dataset.vt = "record"
  const vt = start(async () => {
    opts.source.style.viewTransitionName = ""
    opts.push(opts.href)
    target = await waitFor(
      () => [...document.querySelectorAll<HTMLElement>(".canvas .head h1")].find((h) => h.textContent === opts.title) ?? null,
      HOLD_MS,
    )
    if (target) target.style.viewTransitionName = name
  })
  vt.finished.finally(() => {
    if (target) target.style.viewTransitionName = ""
    delete root.dataset.vt
  })
  return true
}
