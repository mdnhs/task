import { IconSprite } from "@/components/icons"
import { Sk, SkGroup } from "@/components/sk"

import { AppPromo, Logo } from "./sidebar-parts"

// Mirrors AppShell: static parts (logo, nav labels, promo card) render for real, data parts are blocks.
// Item counts match public/data/shell/navigation.json (9 menu, 2 general, 3 departments).
const NAV_WIDTHS = { menu: [92, 60, 110, 140, 120, 100, 170, 120, 116], general: [72, 80] }

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

export function AppShellSkeleton({ children }: { children: React.ReactNode }) {
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
              <Sk w={42} h={42} r="circle" className="sk-on-panel" />
              <Sk h={39} r="pill" className="sk-on-panel sk-search" />
              <Sk w={219} h={41} r="pill" className="sk-on-panel" />
              <div className="top-actions">
                <Sk w={44} h={44} r="circle" className="sk-on-panel" />
                <Sk w={44} h={44} r="circle" className="sk-on-panel" />
                <Sk w={44} h={44} r="circle" className="sk-on-panel" />
                <Sk w={201} h={50} r="pill" className="sk-on-panel" />
              </div>
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

export function ComingSoonSkeleton() {
  return (
    <SkGroup label="Loading section" className="sk-page">
      <div className="head">
        <div>
          <Sk w={200} h={32} r={10} lh={40} />
          <Sk w={180} h={14} lh={20} style={{ marginTop: 8 }} />
        </div>
      </div>
      <section className="card soon">
        <Sk w={72} h={72} r="circle" style={{ marginBottom: 4 }} />
        <Sk w={104} h={26} r="pill" />
        <Sk w={240} h={22} r={8} lh={29} style={{ marginTop: 4 }} />
        <div className="sk-soon-p">
          <Sk w="100%" h={13} lh={22.5} />
          <Sk w="70%" h={13} lh={22.5} />
        </div>
        <Sk w={110} h={11} lh={17} />
        <Sk w={190} h={46} r={14} style={{ marginTop: 10 }} />
      </section>
    </SkGroup>
  )
}
