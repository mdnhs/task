"use client"

import Link from "next/link"
import { ChevronRight, MapPin, Plus } from "lucide-react"

import { PageHead } from "@/components/page-head"
import { resolveMember } from "../admin"
import { grantsStore, locationsStore, templatesStore } from "../store"
import type { LocationAdminData } from "../types"

// Locations admin list (FR-RS-01, 30). One row per site: address, zone, templates and the supervisors. Edits open the form page.
export function LocationsView({ data, scopeKey }: { data: LocationAdminData; scopeKey: string }) {
  const [locations] = locationsStore.useStore(data.locations, scopeKey)
  const [templates] = templatesStore.useStore(data.templates, scopeKey)
  const [grants] = grantsStore.useStore(data.grants, scopeKey)
  return (
    <>
      <Link href="/rosters" className="td-back">← Rosters</Link>
      <PageHead
        title="Locations"
        subtitle="Sites, their shifts and who manages them."
        actions={<Link href="/rosters/locations/new" className="btn btn-primary"><Plus aria-hidden="true" />New location</Link>}
      />
      <div className="card rl-list">
        {locations.length === 0 && <p className="rl-empty">No locations yet.</p>}
        {locations.map((l) => {
          const sups = grants.filter((g) => g.locationId === l.id).map((g) => resolveMember(data.members, g.personId)?.name).filter(Boolean)
          return (
            <Link key={l.id} href={`/rosters/locations/${l.id}`} className="rl-row">
              <span className="rl-ico" aria-hidden="true"><MapPin /></span>
              <span className="rl-main">
                <b>{l.name}</b>
                <span>{l.address}</span>
              </span>
              <span className="rl-meta num">{l.zoneRadiusM} m · {templates.filter((t) => t.locationId === l.id).length} templates</span>
              <span className="rl-sups">{sups.length ? sups.join(", ") : "No supervisor"}</span>
              <ChevronRight aria-hidden="true" className="rl-go" />
            </Link>
          )
        })}
      </div>
    </>
  )
}
