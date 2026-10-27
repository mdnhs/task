"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { MotionConfig, motion } from "motion/react"

import { Icon, IconSprite } from "@/components/icons"
import { RevealObserver } from "@/components/reveal-observer"
import { Button } from "@/components/ui/button"
import { DeptContext } from "@/hooks/use-dept"
import type { Dept } from "@/lib/types"
import { layoutTransition } from "@/lib/motion"
import { cn } from "@/lib/utils"

import type { NavItemData, NavigationData, UserData } from "../types"
import { NavUser } from "./nav-user"
import { AppPromo, Logo } from "./sidebar-parts"

function Nav({ items, onNavigate }: { items: NavItemData[]; onNavigate: () => void }) {
  const pathname = usePathname()
  return (
    <nav className="nav">
      {items.map((n) => (
        <Link
          key={n.label}
          href={n.href}
          className={pathname === n.href ? "active" : undefined}
          aria-current={pathname === n.href ? "page" : undefined}
          title={n.label}
          onClick={onNavigate}
        >
          {/* One shared indicator: on route change it slides from the old item to the new one, across both nav groups */}
          {pathname === n.href && <motion.span layoutId="nav-active" className="nav-ind" transition={layoutTransition} />}
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

export function AppShell({
  navigation,
  user,
  assistant,
  children,
}: {
  navigation: NavigationData
  user: UserData
  // Slot for the AI assistant trigger, so the shell doesn't import another feature.
  assistant?: React.ReactNode
  children: React.ReactNode
}) {
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
          <Logo />

          <div className="sidebar-scroll">
            <div>
              <div className="nav-label">Menu</div>
              <Nav items={navigation.menu} onNavigate={() => setOpen(false)} />
            </div>

            <div>
              <div className="nav-label">General</div>
              <Nav items={navigation.general} onNavigate={() => setOpen(false)} />
            </div>
          </div>

          <AppPromo />
        </aside>
        {open && <div className="scrim" onClick={() => setOpen(false)} />}

        <div className="main">
          <div className="topbar-wrap">
          <header className="topbar">
            <button className="menu-btn" onClick={toggleMenu} aria-label="Toggle menu">
              <Icon name="menu" />
            </button>
            <label className="search">
              <Icon name="search" />
              <input id="q" type="search" placeholder="Search tasks, reports, clients…" aria-label="Search" />
              <Icon name="sliders" />
            </label>
            <div className="seg" role="group" aria-label="Department">
              {navigation.departments.map((f) => (
                <button key={f.dep} aria-pressed={dep === f.dep} onClick={() => setDep(f.dep)}>
                  {dep === f.dep && <motion.span layoutId="seg-active" className="seg-ind" transition={layoutTransition} />}
                  <span className="seg-lbl">{f.label}</span>
                </button>
              ))}
            </div>
            <div className="top-actions">
              {assistant}
              <Button variant="ghost" size="icon-lg" className="icon-btn" aria-label="Messages">
                <Icon name="mail" />
              </Button>
              <Button
                variant="ghost"
                size="icon-lg"
                className="icon-btn"
                aria-label={user.unreadNotifications ? `Notifications, ${user.unreadNotifications} unread` : "Notifications"}
              >
                <Icon name="bell" />
                {user.unreadNotifications > 0 && (
                  <span className="dot count num" aria-hidden="true">
                    {user.unreadNotifications > 9 ? "9+" : user.unreadNotifications}
                  </span>
                )}
              </Button>
              <NavUser user={user} />
            </div>
          </header>
          </div>

          <main className="canvas">{children}</main>
        </div>
      </div>
    </DeptContext.Provider>
    </MotionConfig>
  )
}
