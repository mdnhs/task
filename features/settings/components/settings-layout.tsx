"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { motion } from "motion/react"

import { Icon } from "@/components/icons"
import { useSlideDir } from "@/components/data-pagination"
import { PageHead } from "@/components/page-head"
import { layoutTransition } from "@/lib/motion"
import { SETTINGS_TABS, isTab } from "../types"
import type { SettingsTabId } from "../types"

// Settings shell: tab list on the left (scrolling pills on phones) next to the active tab's content.
// Every panel arrives with the page, so switching tabs is in place: a shallow URL update, no server round-trip, no loading.tsx flash.
export function SettingsLayout({
  tab: initial,
  readOnly,
  panels,
}: {
  tab: SettingsTabId
  readOnly?: boolean
  /** Rendered panel per tab. A missing one falls back to a normal navigation. */
  panels: Partial<Record<SettingsTabId, React.ReactNode>>
}) {
  const pathname = usePathname()
  const urlTab = pathname.split("/")[2] ?? initial
  const [tab, setTab] = useState<SettingsTabId>(initial)
  const [seen, setSeen] = useState(urlTab)
  // Back/forward lands here.
  if (seen !== urlTab) {
    setSeen(urlTab)
    if (isTab(urlTab)) setTab(urlTab)
  }
  const label = SETTINGS_TABS.find((t) => t.id === tab)?.label
  // Next tab (lower in the list) slides in from the right, previous from the left.
  const dir = useSlideDir(SETTINGS_TABS.findIndex((t) => t.id === tab))
  useEffect(() => {
    if (label) document.title = `${label} · Settings · OpsDesk`
  }, [label])

  return (
    <>
      <PageHead title="Settings" subtitle={readOnly ? "Workspace settings. You have read-only access." : "Workspace settings: organisation, people, notifications, billing and privacy"} />
      <div className="set-layout">
        <nav className="set-tabs" aria-label="Settings sections">
          {SETTINGS_TABS.map((t) => (
            <Link
              key={t.id}
              href={`/settings/${t.id}`}
              className="set-tab"
              aria-current={t.id === tab ? "page" : undefined}
              scroll={false}
              onClick={(e) => {
                if (!panels[t.id] || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                e.preventDefault()
                if (t.id === tab) return
                setTab(t.id)
                window.history.pushState(null, "", `/settings/${t.id}`)
              }}
            >
              {t.id === tab && <motion.span layoutId="set-tab-bg" className="set-tab-bg" transition={layoutTransition} />}
              <Icon name={t.icon} />
              <span>{t.label}</span>
            </Link>
          ))}
        </nav>
        <div key={tab} className="set-body od-slide" data-slide={dir}>
          {panels[tab]}
        </div>
      </div>
    </>
  )
}
