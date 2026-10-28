"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AnimatePresence, animate, motion } from "motion/react"

import { Icon } from "@/components/icons"
import { RollNumber } from "@/components/roll-number"
import { Sk, SkGroup } from "@/components/sk"
import { DUR, EASE, layoutTransition, listItem } from "@/lib/motion"
import { cn } from "@/lib/utils"

import {
  EMPTY_FILTERS,
  TYPE_ICONS,
  countFilters,
  filterChips,
  filterOptions,
  groupResults,
  highlight,
  humanStatus,
  removeLastFilter,
  searchItems,
} from "../match"
import { pushRecent, readRecents, removeRecent, writeRecents } from "../recents"
import { isFilterShortcut, isMacPlatform, isNewTabEnter, isSlashShortcut, isToggleShortcut, shortcutLabel } from "../shortcuts"
import type { FilterKey, SearchConfig, SearchFilters, SearchItem } from "../types"
import { searchIndex } from "../actions"
import { isInsideSearch } from "../containment"
import { FiltersForm } from "./filters-form"

// One navigable row in the panel (quick action, recent, popular chip, result). Focus stays in the input
// (combobox + aria-activedescendant); options are also reachable with Tab and arrows (roving tabindex).
type Opt = { id: string; href?: string; fill?: string }

const noop = () => () => {}
const macSnapshot = () => isMacPlatform(navigator.platform || navigator.userAgent)
// Server and hydration render `null` (no hint), then the client value: no hydration mismatch, no setState in an effect.
const useIsMac = () => React.useSyncExternalStore(noop, macSnapshot, () => null)

const recentsListeners = new Set<() => void>()
let recentsCache: string[] | null = null
const recentsStore = {
  subscribe(fn: () => void) {
    recentsListeners.add(fn)
    return () => recentsListeners.delete(fn)
  },
  get() {
    if (recentsCache === null) recentsCache = readRecents()
    return recentsCache
  },
  set(next: string[]) {
    recentsCache = next
    writeRecents(next)
    recentsListeners.forEach((fn) => fn())
  },
}
const EMPTY: string[] = []

function Hl({ text, q }: { text: string; q: string }) {
  return (
    <>
      {highlight(text, q).map((s, i) => (s.hit ? <mark key={i}>{s.text}</mark> : <React.Fragment key={i}>{s.text}</React.Fragment>))}
    </>
  )
}

// Chips and recents: enter with a small scale, collapse out while siblings close the gap (layout).
const chipMotion = {
  initial: { opacity: 0, scale: 0.92 },
  animate: { opacity: 1, scale: 1, transition: { duration: DUR.fast, ease: EASE } },
  exit: { opacity: 0, scale: 0.92, transition: { duration: DUR.fast, ease: EASE } },
}
const rowExit = { opacity: 0, x: -8, transition: { duration: DUR.fast, ease: EASE } }

// Surface morph (pill → panel). Near-critical damping so the corner radius never overshoots; interruptible.
const MORPH = { type: "spring" as const, stiffness: 320, damping: 36, mass: 0.9 }

const reducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
  } catch {
    return false
  }
}

// The index is loaded lazily on the first open (server action, role-filtered on the server) and cached for the session.
// It is never part of a page's RSC payload, so pages don't carry other modules' text.
type SearchData = { items: SearchItem[]; config: SearchConfig }
let dataCache: Promise<SearchData> | null = null
const loadSearch = () =>
  (dataCache ??= searchIndex().catch((e: unknown) => {
    dataCache = null
    throw e
  }))
const NO_ITEMS: SearchItem[] = []
const NO_CONFIG: SearchConfig = { popular: [], actions: [] }

const optId = (id: string) => `od-sopt-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`

export function GlobalSearch({
  departments,
  today,
}: {
  // Tenant departments from shell data (never hard-coded).
  departments: string[]
  // Tenant "today" (org.today) for the date-range presets.
  today: string
}) {
  const router = useRouter()
  const mac = useIsMac()
  const recents = React.useSyncExternalStore(recentsStore.subscribe, recentsStore.get, () => EMPTY)

  const [open, setOpen] = React.useState(false)
  // Keeps the sections mounted while the surface collapses back into the pill.
  const [closing, setClosing] = React.useState(false)
  const [view, setView] = React.useState<"list" | "filters">("list")
  const [q, setQ] = React.useState("")
  const [filters, setFilters] = React.useState<SearchFilters>(EMPTY_FILTERS)
  const [active, setActive] = React.useState(0)
  const [data, setData] = React.useState<SearchData | null>(null)
  const [loadError, setLoadError] = React.useState(false)
  const items = data?.items ?? NO_ITEMS
  const config = data?.config ?? NO_CONFIG

  const rootRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const filterBtnRef = React.useRef<HTMLButtonElement>(null)
  // The one surface: closed it is the topbar pill, open it is the panel (same node, same input).
  const surfaceRef = React.useRef<HTMLDivElement>(null)
  const layerRef = React.useRef<HTMLDivElement>(null)
  // Morph progress (0 = pill, 1 = panel), kept across interruptions.
  const morphT = React.useRef(0)
  const prevFocus = React.useRef<HTMLElement | null>(null)

  const nFilters = countFilters(filters)
  const chips = filterChips(filters)
  const options = React.useMemo(() => filterOptions(items), [items])
  const results = React.useMemo(() => searchItems(items, q, filters), [items, q, filters])
  const groups = React.useMemo(() => groupResults(results), [results])
  const searching = q.trim() !== "" || nFilters > 0

  // Flat, ordered list of navigable options for the current panel.
  const opts: Opt[] = React.useMemo(() => {
    if (searching) return groups.flatMap((g) => g.items.map((i) => ({ id: `r-${i.id}`, href: i.href })))
    return [
      ...config.actions.map((a) => ({ id: `a-${a.id}`, href: a.href })),
      ...recents.map((r) => ({ id: `h-${r}`, fill: r })),
      ...config.popular.map((p) => ({ id: `p-${p}`, fill: p })),
    ]
  }, [searching, groups, config, recents])
  const cur = Math.min(active, Math.max(0, opts.length - 1))
  const activeId = open && view === "list" && opts[cur] ? optId(opts[cur].id) : undefined

  const openPanel = React.useCallback((v: "list" | "filters" = "list") => {
    loadSearch().then(
      (d) => {
        setData(d)
        setLoadError(false)
      },
      () => setLoadError(true),
    )
    setOpen(true)
    setClosing(false)
    setView(v)
  }, [])

  const close = React.useCallback((restore: boolean) => {
    // Sections stay mounted while the surface collapses back into the pill (see the morph effect).
    // Reduced motion: no collapse, the surface snaps back to the pill at once.
    if (open && !reducedMotion()) setClosing(true)
    else {
      if (layerRef.current) layerRef.current.style.width = ""
      if (surfaceRef.current) surfaceRef.current.style.clipPath = ""
      morphT.current = 0
    }
    setOpen(false)
    const back = prevFocus.current
    prevFocus.current = null
    if (restore && back && back !== inputRef.current && document.contains(back)) back.focus()
  }, [open])

  // ⌘K / Ctrl+K toggles; "/" opens (not while typing elsewhere).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMac = isMacPlatform(navigator.platform || navigator.userAgent)
      const toggle = isToggleShortcut(e, isMac)
      if (!toggle && !isSlashShortcut(e, e.target as HTMLElement | null)) return
      e.preventDefault()
      if (toggle && open) {
        close(true)
        return
      }
      if (!rootRef.current?.contains(document.activeElement)) prevFocus.current = document.activeElement as HTMLElement | null
      openPanel("list")
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, close, openPanel])

  // Warm the lazily loaded index once the page is idle, so the first open doesn't grow when results arrive mid-morph.
  React.useEffect(() => {
    const t = window.setTimeout(() => {
      loadSearch().then(setData, () => {})
    }, 1200)
    return () => window.clearTimeout(t)
  }, [])

  // Click outside closes.
  React.useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (isInsideSearch(e.target as Element | null, rootRef.current)) return
      close(false)
    }
    document.addEventListener("pointerdown", onDown)
    return () => document.removeEventListener("pointerdown", onDown)
  }, [open, close])

  // Airbnb-style morph on ONE surface, with clip-path only (ui-rules 15: never animate width/height). The root stays in
  // the topbar flow as a same-size placeholder. Open: the layer is laid out at its final panel width at once and the
  // surface's clip starts at exactly the pill's rect + radius, then springs to inset(0 round --r-lg). Children are
  // never scaled or resized, so nothing snaps on the last frame. Close: sections fade (CSS), the clip springs back to the
  // pill, then the layer returns to pill width (visually identical, so no blink). Interruptible: each animate() starts
  // from the current clip. The shadow is a sibling layer that fades with opacity. Reduced motion: instant, no clip.
  React.useLayoutEffect(() => {
    const layer = layerRef.current
    const el = surfaceRef.current
    const root = rootRef.current
    if (!layer || !el || !root || (!open && !closing)) return
    const r = root.getBoundingClientRect()
    const pillW = r.width
    const pillH = r.height
    const narrow = window.matchMedia("(max-width:640px)").matches
    const panelW = narrow ? pillW : Math.round(Math.max(pillW, Math.min(640, window.innerWidth - r.left - 12)))
    const radius = parseFloat(getComputedStyle(root).getPropertyValue("--r-lg")) || 20
    if (open) layer.style.width = `${panelW}px`
    if (reducedMotion()) return
    // One spring drives a 0 (pill) → 1 (panel) progress; the clip is computed per frame from it, against the live size
    // (so content that changes height mid-morph is followed). At 1 the clip is removed: inset(0 round --r-lg) equals the
    // surface's own radius, so that frame is identical.
    const apply = (t: number) => {
      if (t >= 1) {
        el.style.clipPath = ""
        return
      }
      const right = (layer.offsetWidth - pillW) * (1 - t)
      const bottom = Math.max(0, el.offsetHeight - pillH) * (1 - t)
      const round = pillH / 2 + (radius - pillH / 2) * t
      el.style.clipPath = `inset(0px ${right}px ${bottom}px 0px round ${round}px)`
    }
    let live = true
    if (open && morphT.current === 0) apply(0) // first frame: exactly the pill
    const a = animate(morphT.current, open ? 1 : 0, {
      ...MORPH,
      delay: open ? 0 : 0.06,
      onUpdate: (t) => {
        morphT.current = t
        apply(t)
      },
    })
    if (open) a.then(() => live && apply(1))
    else
      a.then(() => {
        if (!live) return
        morphT.current = 0
        layer.style.width = ""
        el.style.clipPath = ""
        setClosing(false)
      })
    return () => {
      live = false
      a.stop()
    }
  }, [open, closing])

  // Keep the highlighted option in view.
  React.useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" })
  }, [activeId])

  const saveRecent = (query: string) => {
    if (query.trim()) recentsStore.set(pushRecent(recentsStore.get(), query))
  }

  const go = (href: string, newTab = false) => {
    saveRecent(q)
    if (newTab) {
      window.open(href, "_blank", "noopener")
      return
    }
    close(false)
    setQ("")
    inputRef.current?.blur()
    router.push(href)
  }

  const pick = (o: Opt, newTab = false) => {
    if (o.href) go(o.href, newTab)
    else if (o.fill) {
      setQ(o.fill)
      setActive(0)
      inputRef.current?.focus()
    }
  }

  const setFilter = (k: FilterKey, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }))
    setActive(0)
  }

  // Shared ↑↓ / Home / End / Enter / Esc handling for the input and the options.
  const onNavKey = (e: React.KeyboardEvent, fromInput: boolean) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (isFilterShortcut(e)) {
      e.preventDefault()
      openPanel("filters")
      return
    }
    const move = (to: number) => {
      e.preventDefault()
      if (!open) openPanel("list")
      if (opts.length === 0) return
      const next = (to + opts.length) % opts.length
      setActive(next)
      if (!fromInput) document.getElementById(optId(opts[next].id))?.focus()
    }
    switch (e.key) {
      case "ArrowDown":
        return move(open ? cur + 1 : cur)
      case "ArrowUp":
        return move(cur - 1)
      case "Home":
        if (!fromInput) move(0)
        return
      case "End":
        if (!fromInput) move(opts.length - 1)
        return
      case "Enter": {
        const o = opts[cur]
        if (!open || !o) return
        e.preventDefault()
        pick(o, !!(mac !== null && isNewTabEnter(e, mac)) && !!o.href)
        return
      }
      case "Escape":
        e.preventDefault()
        if (q) {
          setQ("")
          setActive(0)
          if (!fromInput) inputRef.current?.focus()
        } else if (open) close(true)
        return
      case "Backspace":
        if (fromInput && q === "" && nFilters > 0) {
          e.preventDefault()
          setFilters(removeLastFilter(filters))
        }
        return
    }
  }

  const optProps = (o: Opt, i: number) => ({
    id: optId(o.id),
    role: "option" as const,
    "aria-selected": i === cur,
    "data-active": i === cur ? "" : undefined,
    tabIndex: i === cur ? 0 : -1,
    onPointerMove: () => i !== cur && setActive(i),
    onKeyDown: (e: React.KeyboardEvent) => onNavKey(e, false),
  })

  let idx = 0
  const next = () => idx++

  const deptOpts = departments.filter((d) => d && d.toLowerCase() !== "all")

  // One input and one filter button: they live in the topbar pill while closed and move into the panel's
  // full-width field while open (focus is handed over in a layout effect, so it is never lost).
  const inputEl = (
        <input
          ref={inputRef}
          id="q"
          type="search"
          role="combobox"
          aria-label="Search"
          aria-expanded={open && view === "list"}
          aria-controls="od-search-list"
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-keyshortcuts={mac === null ? undefined : mac ? "Meta+K /" : "Control+K /"}
          autoComplete="off"
          placeholder="Search tasks, reports, clients…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setActive(0)
            if (!open || view !== "list") openPanel("list")
          }}
          onFocus={() => {
            if (!open) openPanel("list")
          }}
          onClick={() => !open && openPanel("list")}
          onKeyDown={(e) => onNavKey(e, true)}
        />
  )
  const clearEl = q !== "" && (
          <button
            type="button"
            className="od-search-clear"
            aria-label="Clear search"
            onClick={() => {
              setQ("")
              setActive(0)
              inputRef.current?.focus()
            }}
          >
            ×
          </button>
  )
  const filterEl = (
        <button
          ref={filterBtnRef}
          type="button"
          className="od-search-fbtn"
          aria-label={nFilters ? `Search filters, ${nFilters} active` : "Search filters"}
          aria-expanded={open && view === "filters"}
          aria-keyshortcuts="Alt+F"
          onClick={() => (open && view === "filters" ? setView("list") : openPanel("filters"))}
        >
          <Icon name="sliders" />
          {nFilters > 0 && (
            <span key={nFilters} className="od-search-badge num" aria-hidden="true">
              {nFilters}
            </span>
          )}
        </button>
  )

  return (
    <div
      className={cn("search od-search", open && "is-open")}
      ref={rootRef}
      onBlur={(e) => {
        // Tabbing out closes; clicks inside on non-focusable parts (relatedTarget null) don't.
        const to = e.relatedTarget as Node | null
        if (open && to && !isInsideSearch(to as Element, rootRef.current)) close(false)
      }}
    >
      <div ref={layerRef} className="od-search-layer" data-state={open ? "open" : closing ? "closing" : "closed"}>
      <div className="od-search-shadow" aria-hidden="true" />
      <div ref={surfaceRef} className="od-search-surface">
        <div className="od-search-field">
          <Icon name="search" />
          {inputEl}
          {clearEl}
          {!open && mac !== null && q === "" && (
            <kbd className="od-search-kbd" aria-hidden="true">
              {shortcutLabel(mac)}
            </kbd>
          )}
          {filterEl}
        </div>
      {(open || closing) && (
        <div className="od-search-panel" role="dialog" aria-label="Search" data-state={open ? "open" : "closed"}>
          <div className="od-search-inner">
          <AnimatePresence initial={false}>
            {chips.length > 0 && (
              <motion.div key="chips" className="od-search-chips" aria-label="Active filters" {...chipMotion}>
                <AnimatePresence initial={false} mode="popLayout">
                  {chips.map((c) => (
                    <motion.span key={c.key} layout="position" className="od-search-chip is-filter" {...chipMotion}>
                      {c.label}
                      <button type="button" tabIndex={-1} aria-label={`Remove filter ${c.label}`} onClick={() => setFilter(c.key, "")}>
                        ×
                      </button>
                    </motion.span>
                  ))}
                  <motion.button
                    key="clear"
                    layout="position"
                    type="button"
                    tabIndex={-1}
                    className="od-search-link"
                    onClick={() => setFilters(EMPTY_FILTERS)}
                    transition={layoutTransition}
                  >
                    Clear all
                  </motion.button>
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>

          {view === "filters" ? (
            <FiltersForm
              filters={filters}
              departments={deptOpts}
              owners={options.owners}
              statuses={options.statuses}
              types={options.types}
              today={today}
              onChange={setFilter}
              onRange={(from, to) => setFilters((f) => ({ ...f, from, to }))}
              onReset={() => setFilters(EMPTY_FILTERS)}
              onDone={() => {
                setView("list")
                inputRef.current?.focus()
              }}
            />
          ) : (
            <div className="od-search-body" id="od-search-list" role="listbox" aria-label={searching ? "Search results" : "Suggestions"}>
              {!data ? (
                loadError ? (
                  <div className="od-search-empty" role="presentation">
                    <p className="od-search-empty-t">Search is unavailable</p>
                    <p className="od-search-empty-s">Check your connection and try again.</p>
                  </div>
                ) : (
                  <SkGroup label="Loading search" className="od-search-loading">
                    {[72, 56, 64, 48].map((w, i) => (
                      <span key={i} className="od-search-sk-row">
                        <Sk w={16} h={16} r="circle" />
                        <Sk w={`${w}%`} h={12} r="pill" />
                      </span>
                    ))}
                  </SkGroup>
                )
              ) : searching ? (
                groups.length === 0 ? (
                  <div className="od-search-empty" role="presentation">
                    <Icon name="search" />
                    <p className="od-search-empty-t">No results{q.trim() ? <> for “{q.trim()}”</> : null}</p>
                    <p className="od-search-empty-s">Try another word{nFilters ? " or remove a filter" : ""}.</p>
                  </div>
                ) : (
                  <AnimatePresence initial={false} mode="popLayout">
                  {groups.map((g) => (
                    <motion.div
                      key={g.type}
                      layout="position"
                      transition={layoutTransition}
                      role="group"
                      aria-labelledby={`od-sg-${g.type}`}
                      className="od-search-sec"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1, transition: { duration: DUR.base, ease: EASE } }}
                      exit={{ opacity: 0, transition: { duration: DUR.fast, ease: EASE } }}
                    >
                      <div className="od-search-sec-h" id={`od-sg-${g.type}`}>
                        {g.label}
                        <span className="od-search-count num">
                          <RollNumber value={String(g.total)} duration={DUR.base} />
                        </span>
                      </div>
                      <AnimatePresence initial={false} mode="popLayout">
                      {g.items.map((it) => {
                        const i = next()
                        return (
                          <motion.div
                            key={it.id}
                            role="presentation"
                            className="od-search-li"
                            layout="position"
                            transition={layoutTransition}
                            initial={listItem.initial}
                            animate={listItem.animate}
                            exit={rowExit}
                          >
                          <Link
                            key={it.id}
                            href={it.href}
                            className="od-search-row"
                            {...optProps(opts[i], i)}
                            onClick={(e) => {
                              if (e.metaKey || e.ctrlKey || e.shiftKey) {
                                saveRecent(q)
                                return
                              }
                              e.preventDefault()
                              go(it.href)
                            }}
                          >
                            {i === cur && <motion.span layoutId="od-search-pill" className="od-search-pill" aria-hidden="true" transition={layoutTransition} />}
                            <span className="od-search-ico" aria-hidden="true">
                              <Icon name={TYPE_ICONS[it.type]} />
                            </span>
                            <span className="od-search-main">
                              <span className="od-search-title">
                                <Hl text={it.title} q={q} />
                              </span>
                              <span className="od-search-meta">
                                <span className="num">
                                  <Hl text={it.ref} q={q} />
                                </span>
                                {it.owner && <span>{it.owner}</span>}
                                {it.dept && <span>{it.dept}</span>}
                              </span>
                            </span>
                            {it.status && <span className="od-search-status">{humanStatus(it.status)}</span>}
                          </Link>
                          </motion.div>
                        )
                      })}
                      </AnimatePresence>
                    </motion.div>
                  ))}
                  </AnimatePresence>
                )
              ) : (
                <>
                  {config.actions.length > 0 && (
                    <div role="group" aria-labelledby="od-sg-actions" className="od-search-sec is-stagger" style={{ "--i": 0 } as React.CSSProperties}>
                      <div className="od-search-sec-h" id="od-sg-actions">
                        Quick actions
                      </div>
                      {config.actions.map((a) => {
                        const i = next()
                        return (
                          <Link
                            key={a.id}
                            href={a.href}
                            className="od-search-row"
                            {...optProps(opts[i], i)}
                            onClick={(e) => {
                              if (e.metaKey || e.ctrlKey || e.shiftKey) return
                              e.preventDefault()
                              go(a.href)
                            }}
                          >
                            {i === cur && <motion.span layoutId="od-search-pill" className="od-search-pill" aria-hidden="true" transition={layoutTransition} />}
                            <span className="od-search-ico" aria-hidden="true">
                              <Icon name={a.icon} />
                            </span>
                            <span className="od-search-main">
                              <span className="od-search-title">{a.label}</span>
                            </span>
                            <Icon name="arrow" />
                          </Link>
                        )
                      })}
                    </div>
                  )}

                  {recents.length > 0 && (
                    <div role="group" aria-labelledby="od-sg-recent" className="od-search-sec is-stagger" style={{ "--i": 1 } as React.CSSProperties}>
                      <div className="od-search-sec-h" id="od-sg-recent">
                        Recent searches
                        <button type="button" tabIndex={-1} className="od-search-link" onClick={() => recentsStore.set([])}>
                          Clear
                        </button>
                      </div>
                      <AnimatePresence initial={false} mode="popLayout">
                      {recents.map((r) => {
                        const i = next()
                        return (
                          <motion.div
                            key={r}
                            className="od-search-recent"
                            layout="position"
                            transition={layoutTransition}
                            initial={listItem.initial}
                            animate={listItem.animate}
                            exit={rowExit}
                          >
                            <button type="button" className="od-search-row" {...optProps(opts[i], i)} onClick={() => pick(opts[i])}>
                              {i === cur && <motion.span layoutId="od-search-pill" className="od-search-pill" aria-hidden="true" transition={layoutTransition} />}
                              <span className="od-search-ico" aria-hidden="true">
                                <Icon name="history" />
                              </span>
                              <span className="od-search-main">
                                <span className="od-search-title">{r}</span>
                              </span>
                            </button>
                            <button
                              type="button"
                              tabIndex={-1}
                              className="od-search-x"
                              aria-label={`Remove “${r}” from recent searches`}
                              onClick={() => recentsStore.set(removeRecent(recentsStore.get(), r))}
                            >
                              ×
                            </button>
                          </motion.div>
                        )
                      })}
                      </AnimatePresence>
                    </div>
                  )}

                  {config.popular.length > 0 && (
                    <div role="group" aria-labelledby="od-sg-popular" className="od-search-sec is-stagger" style={{ "--i": 2 } as React.CSSProperties}>
                      <div className="od-search-sec-h" id="od-sg-popular">
                        Popular searches
                      </div>
                      <div className="od-search-chips">
                        {config.popular.map((p) => {
                          const i = next()
                          return (
                            <button key={p} type="button" className="od-search-chip" {...optProps(opts[i], i)} onClick={() => pick(opts[i])}>
                              <span className="od-search-chip-l">{p}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          </div>
        </div>
      )}
      </div>
      </div>
    </div>
  )
}

