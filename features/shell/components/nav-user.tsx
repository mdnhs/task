"use client"

import { useSyncExternalStore, useTransition, type MouseEvent } from "react"
import Link from "next/link"
import { flushSync } from "react-dom"
import { useTheme } from "next-themes"
import { toast } from "sonner"

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
import { signOutAction, switchTenant } from "@/app/actions/session"
import { clearClientStores } from "@/lib/client-stores"
import { userMenu } from "../menu"
import type { ShellSession, UserData } from "../types"
import { Icon } from "@/components/icon"

const noop = () => () => {}

// variant "platform": the operator (platform staff), so the role line is their staff role, Settings is the console's,
// and the tenant-only items (account pages, device, company switch) are left out. No demo switchers: the role is the membership role,
// the company switcher shows only with 2+ memberships (the server re-checks every switch), the device is a read-only label.
export function NavUser({ user, session, variant = "app" }: { user: UserData; session: ShellSession; variant?: "app" | "platform" }) {
  const platform = variant === "platform"
  const { resolvedTheme, setTheme } = useTheme()
  // resolvedTheme is unknown on the server; wait for mount to avoid a hydration mismatch.
  const mounted = useSyncExternalStore(noop, () => true, () => false)
  const [, startTransition] = useTransition()
  const menu = userMenu(session, user, variant)
  const roleLine = menu.roleLine
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
        <span className="avatar av-me">{user.initials}</span>
        <span className="who" title={`${user.name} · ${roleLine}`}>
          <b>{user.name}</b>
          <small>{roleLine}</small>
        </span>
        <Icon name="chevrons-updown" className="user-chevron" size={24} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={10} className="od-menu min-w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="p-0 font-normal">
            <div className="flex items-center gap-2.5 px-2 py-2 text-left">
              <span className="avatar av-me !size-9 !text-xs">{user.initials}</span>
              <div className="grid flex-1 leading-tight">
                <span className="od-menu-name truncate">{user.name}</span>
                <span className="od-menu-sub truncate">{user.email}</span>
              </div>
            </div>
            {menu.device && (
              <div className="od-menu-device" data-registered={menu.device.registered || undefined} title="The device this session is using">
                <Icon name="devices" size={24} />
                <span className="truncate">{menu.device.label}</span>
              </div>
            )}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {!platform && (
            <>
              <DropdownMenuItem render={<Link href="/account/profile" />}>
                <Icon name="verified" size={24} />
                Account
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/account/notifications" />}>
                <Icon name="bell" size={24} />
                Notifications
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem render={<Link href={platform ? "/platform/settings" : "/settings"} />}>
            <Icon name="gear" size={24} />
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem
            closeOnClick={false}
            role="menuitemcheckbox"
            aria-checked={dark}
            onClick={toggleTheme}
          >
            <Icon name="moon" size={24} />
            Dark mode
            <span className="od-switch" data-on={dark || undefined} aria-hidden="true"><i /></span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {menu.companies && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Icon name="building" size={24} />
              Switch company
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="od-menu min-w-56">
              {menu.companies.map((c) => (
                <DropdownMenuItem key={c.slug} onClick={() => startTransition(async () => { if (c.current) return; if ((await switchTenant(c.slug)).ok) clearClientStores("tenant_switch"); else toast.error("Could not switch company.") })}>
                  {c.name}
                  {c.current && <Icon name="check" className="od-check" size={24} />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <Icon name="help" size={24} />
          Help
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => startTransition(() => { clearClientStores("sign_out"); return signOutAction() })}>
          <Icon name="logout" size={24} />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
