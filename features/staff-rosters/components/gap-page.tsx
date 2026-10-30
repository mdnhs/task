"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { nowInTz } from "@/lib/dates"
import { rostersHref, updateGapCover } from "../logic"
import type { GapCoverInput } from "../logic"
import { gapsStore } from "../store"
import { COVERAGE } from "../types"
import type { RosterGap, StaffMember } from "../types"
import { GapDetail } from "./details"
import { GapDialog } from "./gap-dialog"

const BACK = rostersHref("gaps")

// /staff-rosters/gaps/[id]: one roster gap (FR-ROSTER-02/03). Seeds the gaps store exactly like /staff-rosters, so a cover
// update made here shows on the Roster gaps tab. "Update cover" keeps the short GapDialog; Save returns to that tab.
export function GapPage({
  id,
  gaps,
  staff,
  today,
  tz,
  tzLabel,
  canWrite,
  sensitive,
  actor,
  scopeKey,
}: {
  id: string
  gaps: RosterGap[]
  staff: StaffMember[]
  today: string
  tz: string
  tzLabel: string
  canWrite: boolean
  sensitive: boolean
  actor: string
  scopeKey: string
}) {
  const router = useRouter()
  const [allGaps, setGaps] = gapsStore.useStore(gaps, scopeKey)
  const [editing, setEditing] = useState(false)
  // The route only renders for ids in the seed (notFound otherwise); the store copy carries edits made this session.
  const gap = allGaps.find((g) => g.id === id) ?? gaps.find((g) => g.id === id)
  if (!gap) return null

  function save(gid: string, v: GapCoverInput) {
    const at = nowInTz(today, tz)
    setGaps((prev) => prev.map((g) => (g.id === gid ? updateGapCover(g, v, at, actor) : g)))
    toast.success(`${gid} updated: ${COVERAGE[v.coverage].label.toLowerCase()}`)
    router.push(BACK)
  }

  return (
    <>
      <Link href={BACK} className="sr-back">← Roster gaps</Link>
      <PageHead
        title={`${gap.site} · ${gap.role}`}
        subtitle={<span className="sr-sheet-pills"><StatusPill status={COVERAGE[gap.coverage]} /><span className="sr-ref num">{gap.id}</span></span>}
        actions={
          canWrite && (
            <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>Update cover</button>
          )
        }
      />
      <div className="card sr-page-card">
        <GapDetail gap={gap} sensitive={sensitive} today={today} tzLabel={tzLabel} />
      </div>
      {canWrite && <GapDialog gap={gap} open={editing} onOpenChange={setEditing} staff={staff} onSave={save} />}
    </>
  )
}
