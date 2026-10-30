"use client"

import * as React from "react"
import Link from "next/link"
import { AlarmClock, BellRing, CalendarClock, CreditCard, FileCheck2, Hourglass, KeyRound, ListChecks, Repeat2, RotateCcw, type LucideIcon } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"

import { FilterSeg } from "@/components/filter-bar"
import { Icon } from "@/components/icons"
import { RollNumber } from "@/components/roll-number"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useNotifyFeed } from "@/hooks/use-notify-feed"
import type { NotifyContext } from "@/lib/notify"
import { formatDue } from "@/lib/dates"
import { DUR, EASE, STAGGER, layoutTransition, listItem, numDir } from "@/lib/motion"
import { cn } from "@/lib/utils"

import type { Notification, NotificationType } from "../types"

const ICONS: Record<NotificationType, LucideIcon> = {
  assigned: ListChecks,
  reassigned: Repeat2,
  deadline: CalendarClock,
  evidence: FileCheck2,
  "report-returned": RotateCcw,
  "manager-action": BellRing,
  reminder: AlarmClock,
  payment: CreditCard,
  access: KeyRound,
  trial: Hourglass,
}

type Tab = "all" | "unread"

// Unread dot / badge leaving: a quick shrink + fade (the badge also arrives this way when the first unread comes in).
const dotMotion = {
  initial: { opacity: 0, scale: 0.4 },
  animate: { opacity: 1, scale: 1, transition: { duration: DUR.fast, ease: EASE } },
  exit: { opacity: 0, scale: 0.4, transition: { duration: DUR.fast, ease: EASE } },
}
const badge = (n: number) => (n > 9 ? "9+" : String(n))

// Bell + panel. The list lives in the notifyFeed store (hooks/use-notify-feed), which also adds due reminders (FR-NOT-02/03). Read state is client state only. One Popover at every width:
// full-width under 640px via CSS (the existing useIsMobile hook breaks at 768).
export function NotificationsPanel({ items, today, tzLabel, scope, notify }: { items: Notification[]; today: string; tzLabel: string; scope: string; notify?: NotifyContext }) {
  const [feed, setList] = useNotifyFeed(items, scope, notify)
  const list = feed as Notification[]
  const [tab, setTab] = React.useState<Tab>("all")
  const [open, setOpen] = React.useState(false)

  const reduce = useReducedMotion()
  // Pending "Mark all read" steps, cleared if the panel goes away mid-cascade.
  const timers = React.useRef<number[]>([])
  React.useEffect(() => {
    const t = timers
    return () => t.current.forEach(clearTimeout)
  }, [])

  const unread = list.filter((n) => !n.read).length
  const shown = tab === "unread" ? list.filter((n) => !n.read) : list
  // The badge count rolls (down as items are read, up when new ones arrive).
  const [prevCount, setPrevCount] = React.useState(unread)
  const [dir, setDir] = React.useState<"up" | "down">("down")
  if (prevCount !== unread) {
    setDir(numDir(String(prevCount), String(unread)))
    setPrevCount(unread)
  }

  const markRead = (id: string) => setList((l) => l.map((n) => (n.id === id ? { ...n, read: true } : n)))
  // Clears the unread dots top→bottom in a short cascade (STAGGER apart); reduced motion: all at once.
  const markAll = () => {
    const ids = list.filter((n) => !n.read).map((n) => n.id)
    if (reduce || ids.length < 2) return setList((l) => l.map((n) => ({ ...n, read: true })))
    timers.current.forEach(clearTimeout)
    timers.current = ids.map((id, i) => window.setTimeout(() => markRead(id), i * STAGGER * 1000))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            className="icon-btn"
            aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
          />
        }
      >
        <Icon name="bell" />
        <AnimatePresence initial={false}>
          {unread > 0 && (
            <motion.span key="badge" className="dot count num" aria-hidden="true" {...dotMotion}>
              <RollNumber value={badge(unread)} dir={dir} duration={DUR.base} />
            </motion.span>
          )}
        </AnimatePresence>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={10} className="od-notif">
        <div className="od-notif-head">
          <span className="od-menu-name">Notifications</span>
          <button type="button" className="od-notif-mark" onClick={markAll} disabled={unread === 0}>
            Mark all read
          </button>
        </div>
        <div className="od-notif-tabs">
          <FilterSeg
            label="Filter notifications"
            value={tab}
            options={[{ value: "all", label: "All" }, { value: "unread", label: `Unread (${unread})` }]}
            onChange={(v) => setTab(v as Tab)}
          />
        </div>
        <div className="od-notif-list">
          {shown.length === 0 && <p className="od-menu-sub-hint">You are all caught up.</p>}
          <AnimatePresence initial={false}>
          {shown.map((n) => {
            const Ico = ICONS[n.type]
            return (
              <motion.div key={n.id} layout="position" {...listItem} transition={layoutTransition}>
              <Link
                href={n.href}
                className={cn("od-notif-row", !n.read && "unread")}
                onClick={() => {
                  markRead(n.id)
                  setOpen(false)
                }}
              >
                <span className="od-notif-ico">
                  <Ico size={16} aria-hidden="true" />
                </span>
                <span className="od-notif-body">
                  <span className="od-notif-title">{!n.read && <span className="sr-only">Unread: </span>}{n.title}</span>
                  <span className="od-menu-sub">
                    {formatDue(n.at, today)} · {tzLabel}
                  </span>
                </span>
                <AnimatePresence initial={false}>
                  {!n.read && <motion.span key="pip" className="od-notif-pip" aria-hidden="true" {...dotMotion} />}
                </AnimatePresence>
              </Link>
              </motion.div>
            )
          })}
          </AnimatePresence>
        </div>
      </PopoverContent>
    </Popover>
  )
}
