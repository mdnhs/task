"use client"

import { useSyncExternalStore, useTransition, type MouseEvent } from "react"
import Link from "next/link"
import { flushSync } from "react-dom"
import { BadgeCheck, Bell, Building2, Check, ChevronsUpDown, CircleHelp, LogOut, Moon, Settings, UserCog } from "lucide-react"
import { useTheme } from "next-themes"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { setRole, setTenant, signOut } from "@/app/actions/session"
import type { ShellSession, UserData } from "../types"

const noop = () => () => {}

export function NavUser({ user, session }: { user: UserData; session: ShellSession }) {
  const { resolvedTheme, setTheme } = useTheme()
  // resolvedTheme is unknown on the server; wait for mount to avoid a hydration mismatch.
  const mounted = useSyncExternalStore(noop, () => true, () => false)
  const [, startTransition] = useTransition()
  // The default owner keeps the signed-in person's own title; other roles show the previewed role.
  const roleLine = session.role.id === "owner" ? user.role : session.role.label
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
        <span className="who" title={`${user.name} · ${roleLine}`}>
          <b>{user.name}</b>
          <small>{roleLine}</small>
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
          <DropdownMenuItem render={<Link href="/account/profile" />}>
            <BadgeCheck />
            Account
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/account/notifications" />}>
            <Bell />
            Notifications
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/settings" />}>
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
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <UserCog />
            View as (preview)
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="od-menu min-w-56">
            <div className="od-menu-sub-hint">Demo preview of each role</div>
            {session.roles.map((r) => (
              <DropdownMenuItem key={r.id} onClick={() => startTransition(() => setRole(r.id))}>
                {r.label}
                {r.id === session.role.id && <Check className="od-check" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Building2 />
            Switch company
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="od-menu min-w-56">
            {session.tenants.map((t) => (
              <DropdownMenuItem key={t.id} onClick={() => startTransition(() => setTenant(t.id))}>
                {t.name}
                {t.id === session.tenant.id && <Check className="od-check" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <CircleHelp />
          Help
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => startTransition(() => signOut())}>
          <LogOut />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
