import { IconSprite } from "@/components/icons"
import { Sk, SkGroup } from "@/components/sk"

import { SEG_MAX } from "../constants"
import type { NavItemData, NavigationData } from "../types"
import { AppPromo, Logo, PlatformContext } from "./sidebar-parts"

// Mirrors AppShell: static parts (logo, nav labels, promo card) render for real, data parts are blocks.
// Nav item counts match public/data/shell/navigation.json (9 menu, 2 general).
const NAV_WIDTHS = { menu: [92, 60, 110, 140, 120, 100, 170, 120, 116], general: [72, 80] }

// Mirrors DeptSeg. Up to SEG_MAX pills: one block sized by the real labels, set invisible, so the width matches
// exactly for any tenant. Beyond that: the carousel's fixed-basis block.
function DeptSegSkeleton({ departments }: { departments: NavigationData["departments"] }) {
  if (departments.length > SEG_MAX) return <Sk h={50} r="pill" className="sk-on-panel sk-seg-carousel" />
  return (
    <span aria-hidden="true" className="sk sk-on-panel sk-seg">
      {departments.map((d) => (
        <span key={d.dep}>{d.label}</span>
      ))}
    </span>
  )
}

// Phones: the full-width pill row under the search (DeptRow). Hidden above 640px by CSS.
function DeptRowSkeleton() {
  return <Sk h={52} r="pill" className="sk-on-panel sk-dept-row" />
}

function NavSkeleton({ widths }: { widths: number[] }) {
  return (
    <div className="nav">
      {widths.map((w, i) => (
        <div key={i} className="sk-nav-row">
          <Sk w={20} h={20} r={6} />
          <Sk w={w} h={12} />
        </div>
      ))}
    </div>
  )
}

// The platform console's grouped nav (D2): section labels are static and render for real. Rows reuse the real `.nav a` box
// (no href, so not focusable) with the label as ghost text, so heights and widths match the loaded sidebar exactly.
function GroupedNavSkeleton({ items }: { items: NavItemData[] }) {
  const groups: { section?: string; items: NavItemData[] }[] = []
  for (const n of items) {
    const g = groups.find((o) => o.section === n.section)
    if (g) g.items.push(n)
    else groups.push({ section: n.section, items: [n] })
  }
  groups.sort((a, b) => Number(!!a.section) - Number(!!b.section))
  return groups.map((g) => (
    <div key={g.section ?? ""}>
      {g.section && <div className="nav-label">{g.section}</div>}
      <div className="nav">
        {g.items.map((n) => (
          <a key={n.href}>
            <Sk w={20} h={20} r={6} />
            <span className="lbl"><span className="sk-ghost">{n.label}</span></span>
          </a>
        ))}
      </div>
    </div>
  ))
}

// No subscription banner here: route loading.tsx renders inside the real layout, so the banner is already present.
export function AppShellSkeleton({
  departments,
  assistant = true,
  whatsapp = true,
  platform,
  children,
}: {
  // `false` = no department filter (the platform console), so neither the desktop pills nor the phone row render.
  departments: NavigationData["departments"] | false
  /** Topbar icons shown by the real shell: the AI assistant (plan module) and the WhatsApp shortcut (role + plan). */
  assistant?: boolean
  whatsapp?: boolean
  /** The platform console variant (AppShell variant="platform"): its filtered menu and environment pill; no promo card. */
  platform?: { menu: NavItemData[]; env?: { label: string; live: boolean } }
  children: React.ReactNode
}) {
  return (
    <>
      <IconSprite />
      <div className="app">
        <aside className="sidebar" aria-hidden="true">
          <Logo />
          <div className="sidebar-scroll">
            {platform ? (
              <GroupedNavSkeleton items={platform.menu} />
            ) : (
              <>
                <div>
                  <div className="nav-label">Menu</div>
                  <NavSkeleton widths={NAV_WIDTHS.menu} />
                </div>
                <div>
                  <div className="nav-label">General</div>
                  <NavSkeleton widths={NAV_WIDTHS.general} />
                </div>
              </>
            )}
          </div>
          {!platform && <AppPromo />}
        </aside>

        <div className="main">
          <div className="topbar-wrap">
            <header className="topbar" aria-hidden="true">
              <Sk w={50} h={50} r="circle" className="sk-on-panel" />
              <Sk h={50} r="pill" className="sk-on-panel sk-search" />
              {departments !== false && <DeptSegSkeleton departments={departments} />}
              {platform && <PlatformContext env={platform.env} />}
              <div className="top-actions">
                {assistant && <Sk w={50} h={50} r="circle" className="sk-on-panel" />}
                {whatsapp && <Sk w={50} h={50} r="circle" className="sk-on-panel" />}
                <Sk w={50} h={50} r="circle" className="sk-on-panel" />
                <Sk w={null} h={50} r="pill" className="sk-on-panel sk-user" />
              </div>
              {departments !== false && <DeptRowSkeleton />}
            </header>
          </div>
          <main className="canvas">{children}</main>
        </div>
      </div>
    </>
  )
}

// Generic page body used while the shell itself loads (route not known yet).
export function PageSkeleton() {
  return (
    <SkGroup label="Loading page" className="sk-page">
      <div className="head">
        <div>
          <Sk w={220} h={32} r={10} lh={40} />
          <Sk w={300} h={14} lh={20} style={{ marginTop: 8 }} />
        </div>
      </div>
      <section className="card sk-fill" />
    </SkGroup>
  )
}
