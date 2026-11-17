"use client"

import * as React from "react"
import Link from "next/link"
import { AlarmClock, BellRing, CalendarClock, CreditCard, FileCheck2, Files, Hourglass, KeyRound, ListChecks, Repeat2, RotateCcw, ShieldCheck, UserPlus, Users, type LucideIcon } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"

import { FilterSeg } from "@/components/filter-bar"
import { Icon } from "@/components/icons"
import { RollNumber } from "@/components/roll-number"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useNotifications } from "@/hooks/use-notifications"
import { formatDue } from "@/lib/dates"
import { DUR, EASE, STAGGER, layoutTransition, listItem, numDir } from "@/lib/motion"
import { cn } from "@/lib/utils"

import { platformFeed } from "../platform-feed"
import type { Notification, NotificationType } from "../types"
import { NotificationsListSkeleton } from "./skeletons"

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
  // The API's notification kinds (B6 T6.4).
  task: ListChecks,
  report: FileCheck2,
  billing: CreditCard,
  security: KeyRound,
  invite: UserPlus,
  member: Users,
  file: Files,
  dsr: ShieldCheck,
  system: BellRing,
}

type Tab = "all" | "unread"

// Unread dot / badge leaving: a quick shrink + fade (the badge also arrives this way when the first unread comes in).
const dotMotion = {
  initial: { opacity: 0, scale: 0.4 },
  animate: { opacity: 1, scale: 1, transition: { duration: DUR.fast, ease: EASE } },
  exit: { opacity: 0, scale: 0.4, transition: { duration: DUR.fast, ease: EASE } },
}
const badge = (n: number) => (n > 9 ? "9+" : String(n))

// The platform console's alerts are still mock (T6.8): static items with read state kept in a client store, like before. The company bell below is the API's.
// Bell + panel. One Popover at every width: full-width under 640px via CSS (the existing useIsMobile hook breaks at 768).
// Company bell: the list is the API's (hooks/use-notifications: 60 s poll while the tab is visible, mark one, mark all). Console bell: static alerts.
export function NotificationsPanel({ items, today, tzLabel, scope, timezone }: { items: Notification[]; today: string; tzLabel: string; scope: string; /** The company's IANA zone: present = the API's bell, absent = the console's static alerts. */ timezone?: string }) {
  return timezone ? <ApiBell today={today} tzLabel={tzLabel} timezone={timezone} /> : <StaticBell items={items} today={today} tzLabel={tzLabel} scope={scope} />
}

function ApiBell({ today, tzLabel, timezone }: { today: string; tzLabel: string; timezone: string }) {
  const n = useNotifications(timezone)
  return <BellView list={n.items as Notification[]} loading={!n.loaded} onRead={n.read} onReadAll={n.readAll} today={today} tzLabel={tzLabel} />
}

function StaticBell({ items, today, tzLabel, scope }: { items: Notification[]; today: string; tzLabel: string; scope: string }) {
  const [list, setList] = platformFeed.useStore(items, scope)
  return (
    <BellView
      list={list}
      loading={false}
      onRead={(id) => setList((l) => l.map((x) => (x.id === id ? { ...x, read: true } : x)))}
      onReadAll={() => setList((l) => l.map((x) => ({ ...x, read: true })))}
      today={today}
      tzLabel={tzLabel}
    />
  )
}

function BellView({ list: source, loading, onRead, onReadAll, today, tzLabel }: { list: Notification[]; loading: boolean; onRead: (id: string) => void; onReadAll: () => void; today: string; tzLabel: string }) {
  const [tab, setTab] = React.useState<Tab>("all")
  const [open, setOpen] = React.useState(false)
  // "Mark all read" clears the dots top to bottom in a short cascade: these ids keep showing as unread until their turn (the data is already read).
  const [hold, setHold] = React.useState<ReadonlySet<string>>(new Set())
  const list = React.useMemo(() => source.map((n) => (n.read && hold.has(n.id) ? { ...n, read: false } : n)), [source, hold])

  const reduce = useReducedMotion()
  // Pending cascade steps, cleared if the panel goes away mid-cascade.
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

  const markRead = (id: string) => onRead(id)
  const markAll = () => {
    const ids = list.filter((n) => !n.read).map((n) => n.id)
    onReadAll()
    if (reduce || ids.length < 2) return
    timers.current.forEach(clearTimeout)
    setHold(new Set(ids))
    timers.current = ids.map((id, i) => window.setTimeout(() => setHold((h) => new Set([...h].filter((x) => x !== id))), i * STAGGER * 1000))
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
          {loading && <NotificationsListSkeleton />}
          {!loading && shown.length === 0 && <p className="od-menu-sub-hint">You are all caught up.</p>}
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
