import { IconSprite } from "@/components/icons"
import { Sk, SkGroup } from "@/components/sk"

import { SEG_MAX } from "../constants"
import type { NavigationData } from "../types"
import { AppPromo, Logo } from "./sidebar-parts"

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

// No subscription banner here: route loading.tsx renders inside the real layout, so the banner is already present.
export function AppShellSkeleton({
  departments,
  children,
}: {
  // `false` = no department filter (the platform console), so neither the desktop pills nor the phone row render.
  departments: NavigationData["departments"] | false
  children: React.ReactNode
}) {
  return (
    <>
      <IconSprite />
      <div className="app">
        <aside className="sidebar" aria-hidden="true">
          <Logo />
          <div className="sidebar-scroll">
            <div>
              <div className="nav-label">Menu</div>
              <NavSkeleton widths={NAV_WIDTHS.menu} />
            </div>
            <div>
              <div className="nav-label">General</div>
              <NavSkeleton widths={NAV_WIDTHS.general} />
            </div>
          </div>
          <AppPromo />
        </aside>

        <div className="main">
          <div className="topbar-wrap">
            <header className="topbar" aria-hidden="true">
              <Sk w={50} h={50} r="circle" className="sk-on-panel" />
              <Sk h={50} r="pill" className="sk-on-panel sk-search" />
              {departments !== false && <DeptSegSkeleton departments={departments} />}
              <div className="top-actions">
                <Sk w={50} h={50} r="circle" className="sk-on-panel" />
                <Sk w={50} h={50} r="circle" className="sk-on-panel" />
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
