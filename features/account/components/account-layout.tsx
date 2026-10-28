"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { motion } from "motion/react"

import { Icon } from "@/components/icons"
import { useSlideDir } from "@/components/data-pagination"
import { PageHead } from "@/components/page-head"
import { layoutTransition } from "@/lib/motion"
import { ACCOUNT_TABS, isTab } from "../types"
import type { AccountTabId } from "../types"

// Account shell, same in-place tab switching as Settings: every panel arrives with the page, so a tab change is a shallow URL update.
export function AccountLayout({ tab: initial, panels }: { tab: AccountTabId; panels: Partial<Record<AccountTabId, React.ReactNode>> }) {
  const pathname = usePathname()
  const urlTab = pathname.split("/")[2] ?? initial
  const [tab, setTab] = useState<AccountTabId>(initial)
  const [seen, setSeen] = useState(urlTab)
  // Back/forward lands here.
  if (seen !== urlTab) {
    setSeen(urlTab)
    if (isTab(urlTab)) setTab(urlTab)
  }
  const label = ACCOUNT_TABS.find((t) => t.id === tab)?.label
  // Next tab (lower in the list) slides in from the right, previous from the left.
  const dir = useSlideDir(ACCOUNT_TABS.findIndex((t) => t.id === tab))
  useEffect(() => {
    if (label) document.title = `${label} · Account · OpsDesk`
  }, [label])

  return (
    <>
      <PageHead title="Account" subtitle="Your own profile, sign-in security and notification preferences" />
      <div className="set-layout">
        <nav className="set-tabs" aria-label="Account sections">
          {ACCOUNT_TABS.map((t) => (
            <Link
              key={t.id}
              href={`/account/${t.id}`}
              className="set-tab"
              aria-current={t.id === tab ? "page" : undefined}
              scroll={false}
              onClick={(e) => {
                if (!panels[t.id] || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                e.preventDefault()
                if (t.id === tab) return
                setTab(t.id)
                window.history.pushState(null, "", `/account/${t.id}`)
              }}
            >
              {t.id === tab && <motion.span layoutId="acc-tab-bg" className="set-tab-bg" transition={layoutTransition} />}
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
