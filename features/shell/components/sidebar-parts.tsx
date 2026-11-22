"use client"

import Link from "next/link"

import { Icon } from "@/components/icon"
import { Sk } from "@/components/sk"
import { brandAssetUrl, type BrandAsset } from "@/lib/branding"

// Static sidebar pieces, shared by AppShell and AppShellSkeleton so the skeleton matches exactly.

// The mark is a fixed 38px box with the brand icon, or the organization's uploaded logo (Settings, Branding; GET /v1/me/tenant brand.logo, served same-origin and pinned to its
// version) contain-fitted in the SAME box, so the skeleton (which cannot know whether a logo exists) never shifts. The tenant app shows the workspace's own name next to the mark (the session's tenant name), cut with an
// ellipsis when long and with the full name as the tooltip; the console (href under /platform) and a missing name show the product name. `skeleton` swaps the text for a block.
export function Logo({ name, href = "/", onNavigate, skeleton, logo }: { name?: string; href?: string; onNavigate?: () => void; skeleton?: boolean; logo?: BrandAsset | null }) {
  const platform = href.startsWith("/platform")
  const org = platform ? "" : (name ?? "").trim()
  const label = org || "OpsDesk"
  const where = platform ? "go to overview" : "go to dashboard"
  return (
    <Link href={href} className="logo" aria-label={skeleton ? undefined : `${label}, ${where}`} title={org || undefined} onClick={onNavigate}>
      {logo && !platform && !skeleton ? (
        <span className="logo-mark has-logo">
          {/* eslint-disable-next-line @next/next/no-img-element -- same-origin, version-pinned, already scanned; next/image would re-encode it */}
          <img src={brandAssetUrl("logo", logo.version)} alt="" />
        </span>
      ) : (
        <span className="logo-mark">
          <Icon name="brand" />
        </span>
      )}
      {skeleton ? (
        <span className="lbl logo-org">
          <Sk w={150} h={14} r="pill" className="sk-on-panel" />
        </span>
      ) : (
        <span className={org ? "lbl logo-org" : "lbl"}>{label}</span>
      )}
    </Link>
  )
}

// Platform console topbar context (D1): which console this is, and the payment environment (Live / Test mode).
export function PlatformContext({ env }: { env?: { label: string; live: boolean } }) {
  return (
    <div className="pf-ctx">
      <span className="pf-badge">Platform</span>
      {env && (
        <span className="pf-env" data-live={env.live || undefined} title={`Payments: ${env.label}`}>
          <i aria-hidden="true" />
          <span className="pf-env-lbl">{env.label}</span>
        </span>
      )}
    </div>
  )
}

export function AppPromo() {
  return (
    <div className="app-card-clip">
      <div className="app-card">
        <h4>Work from anywhere</h4>
        <p>Get the OpsDesk app on Android and iOS.</p>
        <div className="store-btns">
          <button type="button" aria-label="Get it on Google Play">
            <PlayStoreIcon />
            Android
          </button>
          <button type="button" aria-label="Download on the App Store">
            <AppleIcon />
            iOS
          </button>
        </div>
        <div className="powered">Powered by Raynx</div>
      </div>
    </div>
  )
}

function AppleIcon() {
  return (
    <svg className="store-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  )
}

function PlayStoreIcon() {
  return (
    <svg className="store-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22.018 13.298l-3.919 2.218-3.515-3.493 3.543-3.521 3.891 2.202a1.49 1.49 0 0 1 0 2.594zM1.337.924a1.486 1.486 0 0 0-.112.568v21.017c0 .217.045.419.124.6l11.155-11.087L1.337.924zm12.207 10.065l3.258-3.238L3.45.195a1.466 1.466 0 0 0-.946-.179l11.04 10.973zm0 2.067l-11 10.933c.298.036.612-.016.906-.183l13.324-7.54-3.23-3.21z" />
    </svg>
  )
}
