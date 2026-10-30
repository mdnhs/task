"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { MotionConfig, motion } from "motion/react"

import { Icon, IconSprite } from "@/components/icons"
import { RevealObserver } from "@/components/reveal-observer"
import { Button } from "@/components/ui/button"
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel"
import { DeptContext } from "@/hooks/use-dept"
import type { Dept } from "@/lib/types"
import { layoutTransition } from "@/lib/motion"
import { cn } from "@/lib/utils"


import { SEG_MAX } from "../constants"
import type { NavItemData, NavigationData, Notification, ShellSession, UserData } from "../types"
import { DeptRow } from "./dept-row"
import { NavUser } from "./nav-user"
import type { NotifyContext } from "@/lib/notify"
import { NotificationsPanel } from "./notifications-panel"
import { AppPromo, Logo, PlatformContext } from "./sidebar-parts"
import { SubscriptionBanner } from "./subscription-banner"

// The nav item for the current path: an exact match, or (when `nested`) the longest href the path sits below,
// so /platform/tenants/t1 keeps Tenants active. The tenant app matches exactly.
function activeHref(items: NavItemData[], pathname: string, nested: boolean): string | undefined {
  if (items.some((n) => n.href === pathname)) return pathname
  if (!nested) return undefined
  return items.filter((n) => pathname.startsWith(`${n.href}/`)).sort((a, b) => b.href.length - a.href.length)[0]?.href
}

function Nav({ items, active, onNavigate, label }: { items: NavItemData[]; active: string | undefined; onNavigate: () => void; label?: string }) {
  const isActive = (href: string) => href === active
  return (
    <nav className="nav" aria-label={label}>
      {items.map((n) => (
        <Link
          key={n.label}
          href={n.href}
          className={isActive(n.href) ? "active" : undefined}
          aria-current={isActive(n.href) ? "page" : undefined}
          title={n.label}
          aria-label={n.badge ? `${n.label}, ${n.badge.text}` : undefined}
          onClick={onNavigate}
        >
          {/* Shared indicators (bar + background): on route change they slide from the old item to the new one, across both nav groups */}
          {isActive(n.href) && (
            <>
              <motion.span layoutId="nav-active-bg" className="nav-bg" transition={layoutTransition} />
              <motion.span layoutId="nav-active" className="nav-ind" transition={layoutTransition} />
            </>
          )}
          <Icon name={n.icon} />
          <span className="lbl">{n.label}</span>
          {n.badge && (
            <span className={cn("badge num", n.badge.alert && "alert")}>{n.badge.text}</span>
          )}
          {n.lock && (
            <span className="lock" title="Restricted">
              <Icon name="lock" />
            </span>
          )}
        </Link>
      ))}
    </nav>
  )
}

// Groups nav items by their optional `section`, keeping first-seen order. Items without one come first, unlabelled.
function sections(items: NavItemData[]): { section?: string; items: NavItemData[] }[] {
  const out: { section?: string; items: NavItemData[] }[] = []
  for (const n of items) {
    const g = out.find((o) => o.section === n.section)
    if (g) g.items.push(n)
    else out.push({ section: n.section, items: [n] })
  }
  return out.sort((a, b) => Number(!!a.section) - Number(!!b.section))
}

function DeptSeg({
  items,
  dep,
  onChange,
}: {
  items: NavigationData["departments"]
  dep: Dept
  onChange: (dep: Dept) => void
}) {
  const pill = (f: NavigationData["departments"][number]) => (
    <button key={f.dep} aria-pressed={dep === f.dep} onClick={() => onChange(f.dep)}>
      {dep === f.dep && <motion.span layoutId="seg-active" className="seg-ind" transition={layoutTransition} />}
      <span className="seg-lbl">{f.label}</span>
    </button>
  )

  if (items.length <= SEG_MAX) {
    return (
      <div className="seg" role="group" aria-label="Department">
        {items.map(pill)}
      </div>
    )
  }

  return (
    <Carousel opts={{ align: "start", dragFree: true }} className="seg seg-carousel" aria-label="Department">
      <CarouselPrevious variant="ghost" className="seg-nav" />
      <CarouselContent className="seg-track">
        {items.map((f) => (
          <CarouselItem key={f.dep} className="seg-item">
            {pill(f)}
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselNext variant="ghost" className="seg-nav" />
    </Carousel>
  )
}

export function AppShell({
  navigation,
  user,
  session,
  tzLabel,
  today,
  notifications,
  notify,
  assistant,
  search,
  departments,
  variant = "app",
  env,
  bellScope,
  children,
}: {
  navigation: NavigationData
  user: UserData
  session: ShellSession
  tzLabel: string
  today: string
  notifications: Notification[]
  // Reminder schedule and state for generating in-app reminders (lib/notify.ts); omitted where there is no company clock.
  notify?: NotifyContext
  // Slot for the AI assistant trigger, so the shell doesn't import another feature.
  assistant?: React.ReactNode
  // Slot for the global search (features/search), for the same reason. Without it the plain field is shown.
  search?: React.ReactNode
  // `false` hides the department filter (the platform console isn't scoped to a company's departments).
  departments?: false
  /** "platform" = the operator console (D1): no app promo or department filter, a "Platform" badge and the environment pill. */
  variant?: "app" | "platform"
  /** Platform only: payment environment from platform settings, e.g. { label: "Test mode", live: false }. */
  env?: { label: string; live: boolean }
  /** Read-state key for the bell. Defaults to tenant + role; the console passes its own (platform alerts never share tenant state). */
  bellScope?: string
  children: React.ReactNode
}) {
  const platform = variant === "platform"
  const showDepts = departments !== false && !platform
  const grouped = navigation.menu.some((n) => n.section)
  const pathname = usePathname()
  const active = activeHref([...navigation.menu, ...navigation.general], pathname, platform)
  const [dep, setDep] = React.useState<Dept>("all")
  const [open, setOpen] = React.useState(false)
  const [collapsed, setCollapsed] = React.useState(false)

  const toggleMenu = () => {
    if (window.matchMedia("(max-width:1080px)").matches) setOpen(true)
    else setCollapsed((c) => !c)
  }

  return (
    // reducedMotion="user": motion-library animations follow the OS setting, like the CSS rule in opsdesk.css
    <MotionConfig reducedMotion="user">
    <DeptContext.Provider value={dep}>
      <IconSprite />
      <RevealObserver />
      <div className={cn("app", collapsed && "collapsed")}>
        <aside className={cn("sidebar", open && "open")} id="sidebar" aria-label="Main navigation">
          {platform ? <Logo href="/platform" onNavigate={() => setOpen(false)} /> : <Logo tenantId={session.tenant.id} onNavigate={() => setOpen(false)} />}

          <div className="sidebar-scroll">
            {grouped ? (
              sections(navigation.menu).map((g) => (
                <div key={g.section ?? ""}>
                  {g.section && <div className="nav-label">{g.section}</div>}
                  <Nav items={g.items} active={active} label={g.section} onNavigate={() => setOpen(false)} />
                </div>
              ))
            ) : (
              <div>
                <div className="nav-label">Menu</div>
                <Nav items={navigation.menu} active={active} onNavigate={() => setOpen(false)} />
              </div>
            )}

            {navigation.general.length > 0 && (
              <div>
                <div className="nav-label">General</div>
                <Nav items={navigation.general} active={active} onNavigate={() => setOpen(false)} />
              </div>
            )}
          </div>

          {!platform && <AppPromo />}
        </aside>
        {open && <div className="scrim" onClick={() => setOpen(false)} />}

        <div className="main">
          <div className="topbar-wrap">
          <header className="topbar">
            <button className="menu-btn" onClick={toggleMenu} aria-label="Toggle menu">
              <Icon name="menu" />
            </button>
            {search ?? (
              <label className="search">
                <Icon name="search" />
                <input id="q" type="search" placeholder="Search tasks, reports, clients…" aria-label="Search" />
                <Icon name="sliders" />
              </label>
            )}
            {showDepts && <DeptSeg items={navigation.departments} dep={dep} onChange={setDep} />}
            {platform && <PlatformContext env={env} />}
            <div className="top-actions">
              {assistant}
              {/* The nav is already filtered by role and plan, so the shortcut follows it. */}
              {navigation.menu.some((n) => n.href === "/whatsapp") && (
                <Button
                  variant="ghost"
                  size="icon-lg"
                  className="icon-btn"
                  aria-label="WhatsApp inbox"
                  nativeButton={false}
                  render={<Link href="/whatsapp" />}
                >
                  <Icon name="mail" />
                </Button>
              )}
              <NotificationsPanel items={notifications} today={today} tzLabel={tzLabel} scope={bellScope ?? `${session.tenant.id}:${session.role.id}`} notify={notify} />
              <NavUser user={user} session={session} variant={variant} />
            </div>
            {showDepts && <DeptRow items={navigation.departments} dep={dep} onChange={setDep} />}
          </header>
          </div>

          <main className="canvas">
            <SubscriptionBanner tenant={session.tenant} tzLabel={tzLabel} />
            {children}
          </main>
        </div>
      </div>
    </DeptContext.Provider>
    </MotionConfig>
  )
}
