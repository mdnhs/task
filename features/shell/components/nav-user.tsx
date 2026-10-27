"use client"

import { useEffect, useState, type MouseEvent } from "react"
import { flushSync } from "react-dom"
import { BadgeCheck, Bell, ChevronsUpDown, CircleHelp, LogOut, Moon, Settings } from "lucide-react"
import { useTheme } from "next-themes"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { UserData } from "../types"

export function NavUser({ user }: { user: UserData }) {
  const { resolvedTheme, setTheme } = useTheme()
  // resolvedTheme is unknown on the server; wait for mount to avoid a hydration mismatch.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const dark = mounted && resolvedTheme === "dark"

  // Circular reveal from the click point via the View Transitions API.
  // Falls back to an instant switch when unsupported or with reduced motion.
  const toggleTheme = (e: MouseEvent) => {
    const next = dark ? "light" : "dark"
    const apply = () => {
      flushSync(() => setTheme(next))
      document.documentElement.setAttribute("data-theme", next)
    }
    if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      apply()
      return
    }
    const { clientX: x, clientY: y } = e
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
    document.startViewTransition(apply).ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`], opacity: [0.7, 1] },
        { duration: 900, easing: "cubic-bezier(.22,1,.36,1)", pseudoElement: "::view-transition-new(root)" }
      )
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<button type="button" className="user user-trigger" aria-label="Account menu" />}
      >
        <span className="avatar av1">{user.initials}</span>
        <span className="who">
          <b>{user.name}</b>
          <small>{user.role}</small>
        </span>
        <ChevronsUpDown className="user-chevron" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={10} className="od-menu min-w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="p-0 font-normal">
            <div className="flex items-center gap-2.5 px-2 py-2 text-left">
              <span className="avatar av1 !size-9 !text-xs">{user.initials}</span>
              <div className="grid flex-1 leading-tight">
                <span className="od-menu-name truncate">{user.name}</span>
                <span className="od-menu-sub truncate">{user.email}</span>
              </div>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <BadgeCheck />
            Account
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Bell />
            Notifications
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Settings />
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem
            closeOnClick={false}
            role="menuitemcheckbox"
            aria-checked={dark}
            onClick={toggleTheme}
          >
            <Moon />
            Dark mode
            <span className="od-switch" data-on={dark || undefined} aria-hidden="true"><i /></span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <CircleHelp />
          Help
        </DropdownMenuItem>
        <DropdownMenuItem>
          <LogOut />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
